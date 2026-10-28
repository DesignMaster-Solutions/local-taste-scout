// Local Taste Scout: an agent that turns "I run X in city Y" into a cited partnership and
// outreach brief. Each step decides what to ask next from the previous Qloo result, and every
// claim in the brief keeps the operation + correlation id that produced it.

const PII = [/[^\s@]+@[^\s@]+\.[^\s@]+/, /\+?\d[\d\s().-]{7,}\d/];

export function assertNoPersonalData(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && PII.some((re) => re.test(v))) {
      throw new Error(`"${k}" looks like personal data (email/phone). Qloo must not receive it.`);
    }
  }
}

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The first real decision with Qloo data: several tags share a name; prefer the one scoped to
// places, then the closest name. Ambiguity is reported instead of silently guessed.
export function pickTag(results, concept) {
  const tags = Array.isArray(results) ? results : [];
  if (!tags.length) return { tag: null, reason: 'Qloo returned no tag for this concept.', alternatives: [] };
  const want = new Set(words(concept));
  const score = (t) => {
    const blob = `${t.type ?? ''} ${t.subtype ?? ''} ${t.id ?? ''}`.toLowerCase();
    const name = words(t.name);
    const overlap = name.filter((w) => want.has(w)).length / Math.max(name.length, 1);
    // A place-scoped tag drives place recommendations best; venue-ish tags (cuisine, amenity) are a step down.
    return (/:place\b|restaurant/.test(blob) ? 3 : /cuisine|category|amenity|activity_type/.test(blob) ? 2 : 0) + overlap;
  };
  const ranked = tags.map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s);
  const [best, second] = ranked;
  const ambiguous = second && Math.abs(best.s - second.s) < 0.01;
  return {
    tag: best.t,
    reason: ambiguous
      ? `Tie between "${best.t.name}" and "${second.t.name}"; kept the first and flagged it for review.`
      : `"${best.t.name}" is the closest place-scoped match for "${concept}".`,
    ambiguous: Boolean(ambiguous),
    alternatives: ranked.slice(1, 4).map(({ t }) => t.name ?? t.id),
  };
}

const items = (res) => (Array.isArray(res?.results) ? res.results : res?.results?.entities ?? []);
const cite = (res) => ({ operation: res?.operation, correlation_id: res?.execution?.correlation_id, status: res?.status });

export async function scout({ business, concept, city, audience }, run) {
  assertNoPersonalData({ business, concept, city, audience });
  const trace = [];
  const step = async (why, op, input) => {
    const res = await run(op, input);
    trace.push({ why, op, input, ...cite(res), count: res?.result_count ?? items(res).length });
    return res;
  };

  const tagsRes = await step('Resolve the business concept to a Qloo tag', 'find_tags', { query: concept, limit: 15 });
  const choice = pickTag(items(tagsRes), concept);
  if (!choice.tag) return { business, city, choice, trace, partners: [], culture: [], areas: [], status: 'needs_input' };
  const tagRef = choice.tag.id ?? choice.tag.name;

  const partnersRes = await step('Venues nearby that share the same taste audience (partner candidates)', 'recommend', {
    target_type: 'place', signal_tags: [tagRef], filter_location: city, ...(audience ? { demographic: audience, signal_location: city } : {}), explain: true, limit: 8,
  });
  // Direct competitors carry the same tag; partners are adjacent, not identical.
  const partners = items(partnersRes).filter((p) => !words(p.name).some((w) => words(business).includes(w) && w.length > 3));

  const cultureRes = await step('Artists this local taste audience over-indexes on (event and playlist themes)', 'recommend', {
    target_type: 'artist', signal_tags: [tagRef], signal_location: city, limit: 5,
  });

  // Ask "where" about the strongest partner by Qloo id: names like "Thai Food Near Me" are ambiguous worldwide.
  let areas = [];
  let areasRes = null;
  if (partners[0]?.name) {
    areasRes = await step(`Where in ${city} the top partner's audience concentrates (flyers, local ads)`, 'where_popular', {
      entity: partners[0].entity_id ?? partners[0].name, entity_type: 'place', within: city, limit: 5,
    });
    areas = items(areasRes);
  }

  return {
    business, city, concept, choice, trace, status: 'ok',
    partners: partners.slice(0, 5), culture: items(cultureRes).slice(0, 5), areas: areas.slice(0, 5),
    sources: { partners: cite(partnersRes), culture: cite(cultureRes), areas: areasRes ? cite(areasRes) : null },
  };
}

const line = (e) => `- **${e.name ?? e.id}**${e.properties?.address ? ` (${e.properties.address})` : ''}${e.explanation ? `: ${e.explanation}` : ''}`;
// where_popular returns coordinates (no neighborhood names): show them with a map link.
const area = (a) => {
  const { latitude: la, longitude: lo } = a.location ?? {};
  if (la == null) return line(a);
  const pop = a.query?.popularity != null ? `, popularity ${Math.round(a.query.popularity * 100)}%` : '';
  return `- **${la.toFixed(4)}, ${lo.toFixed(4)}** (geohash ${a.location.geohash}${pop}): https://www.google.com/maps?q=${la},${lo}`;
};
const src = (s) => (s ? `_Source: Qloo \`${s.operation}\`, correlation ${s.correlation_id ?? 'n/a'}._` : '');

export function toBrief(r) {
  const out = [`# Local Taste Brief: ${r.business} (${r.city})`, ''];
  out.push(`**Concept resolved:** ${r.choice.tag ? `${r.choice.tag.name} (\`${r.choice.tag.id ?? 'n/a'}\`)` : 'none'}. ${r.choice.reason}`);
  if (r.choice.alternatives?.length) out.push(`Other candidates considered: ${r.choice.alternatives.join(', ')}.`);
  if (r.status !== 'ok') return [...out, '', 'Refine the concept and run again; no recommendation was made from an uncertain tag.'].join('\n');
  out.push('', '## 1. Partner candidates (cross-promotion, bundles, co-hosted nights)', ...r.partners.map(line), src(r.sources.partners));
  out.push('', '## 2. Culture hooks for events and content', ...r.culture.map(line), src(r.sources.culture));
  out.push('', '## 3. Areas to focus flyers and local ads', ...(r.areas.length ? r.areas.map(area) : ['- No area signal returned.']), src(r.sources.areas));
  out.push('', '## What this does not establish',
    '- Qloo describes what groups tend to like, not what any one customer will do.',
    '- Partners are taste-adjacent, not verified as open to a deal: call them before printing anything.',
    '', '## Agent trace', ...r.trace.map((t, i) => `${i + 1}. ${t.why} → \`${t.op}\` ${t.status} (${t.count} results, ${t.correlation_id ?? 'n/a'})`));
  return out.join('\n');
}
