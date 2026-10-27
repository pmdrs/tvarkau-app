// Claude reads the photos: licence plate, vehicle, which violations are visible.
import Anthropic from '@anthropic-ai/sdk';
import { secrets } from './secrets.mjs';
import { VIOLATIONS } from './violations.mjs';

const SCHEMA = {
  type: 'object',
  properties: {
    plate: { type: 'string', description: 'Lithuanian plate without spaces, e.g. ABC123 or EV3518; empty if unreadable' },
    plate_certain: { type: 'boolean' },
    vehicle: { type: 'string', description: 'Colour, make, model in Lithuanian, e.g. "baltas VW Scirocco"' },
    violations: { type: 'array', items: { type: 'string', enum: Object.keys(VIOLATIONS) } },
    extra: { type: 'string', description: 'Short Lithuanian clause with a visible relevant fact, e.g. "pėstieji priversti apeiti automobilį"; empty if none' },
    doubts: { type: 'string', description: 'Lithuanian note on anything uncertain (private plot? sign not visible?); empty if none' },
  },
  required: ['plate', 'plate_certain', 'vehicle', 'violations', 'extra', 'doubts'],
  additionalProperties: false,
};

const SYSTEM = `You review photos a resident took of a parked car in Vilnius, to prepare a report for tvarkaumiesta.lt.
Identify the licence plate and which of these parking violations the photos actually show:
${Object.entries(VIOLATIONS).map(([k, v]) => `- ${k}: ${v.label} (KET ${v.ket})`).join('\n')}
Only list a violation the photos support. "blocking" means pedestrians cannot pass freely on the footway or traffic is obstructed.
If the car may be on a private plot or in a marked parking space, say so in "doubts". Faces and people are irrelevant — never describe them.
Write vehicle, extra and doubts in Lithuanian.`;

export async function analyzeIncident(jpegs, { time, address }) {
  const apiKey = secrets.anthropicKey();
  if (!apiKey) return { error: 'Nėra ANTHROPIC_API_KEY – užpildykite laukus ranka.' };
  const client = new Anthropic({ apiKey });
  const content = [
    ...jpegs.slice(0, 4).map(b => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } })),
    { type: 'text', text: `Photo time: ${time || 'unknown'}. Approximate address from GPS: ${address || 'unknown'}.` },
  ];
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') return { error: 'Claude atsisakė analizuoti nuotraukas – užpildykite laukus ranka.' };
    const text = res.content.find(b => b.type === 'text')?.text;
    return text ? JSON.parse(text) : { error: 'Tuščias Claude atsakymas.' };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'Neteisingas ANTHROPIC_API_KEY.' };
    if (e instanceof Anthropic.RateLimitError) return { error: 'Claude API limitas – bandykite po minutės.' };
    if (e instanceof Anthropic.APIError) return { error: `Claude API klaida ${e.status ?? ''}`.trim() };
    return { error: `Analizė nepavyko: ${e.message}` };
  }
}
