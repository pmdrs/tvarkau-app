import { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, KeyRound, Loader2, LogIn, LogOut, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { postJson } from '@/lib/api';
import { cn } from '@/lib/utils';

const REMEMBER_KEY = 'tvarkau-remember';
const readRemember = () => { try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; } };

export function Settings({ status, cfg, focus, onBack, reload }) {
  useEffect(() => { if (focus) document.getElementById(`set-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus, !!status]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> Atgal</Button>
        <span className="text-xs text-muted-foreground">Nustatymai saugomi serveryje (<code>/data</code>)</span>
      </div>
      {!status ? [0, 1, 2].map(i => <Skeleton key={i} className="h-48 rounded-xl" />) : (
        <>
          <VilniusCard session={status.session} reload={reload} />
          <ApplicantCard applicant={status.applicant} fields={cfg.applicantFields} reload={reload} />
          <AiCard ai={status.ai} reload={reload} />
        </>
      )}
    </div>
  );
}

function VilniusCard({ session, reload }) {
  const [remember, setRemember] = useState(readRemember);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const setRem = v => { setRemember(v); try { localStorage.setItem(REMEMBER_KEY, v ? '1' : '0'); } catch {} };
  const bookmarklet = `javascript:(()=>{const u=localStorage.getItem('user');if(!u){alert('Pirmiausia prisijunkite tvarkaumiesta.lt');return}window.open(${JSON.stringify(location.origin + '/#import=')}+encodeURIComponent(u),'_blank')})()`;

  const login = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await postJson('api/login', { username: user, password: pass, remember });
      const j = await r.json();
      setPass('');
      if (j.ok) { toast.success('Prisijungta prie Vilnius Login'); reload(); } else toast.error(j.error);
    } finally { setBusy(false); }
  };
  const logout = async () => { await fetch('api/logout', { method: 'POST' }); toast('Atsijungta – sesija ištrinta iš serverio'); reload(); };

  return (
    <Card id="set-vilnius" className="scroll-mt-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div><CardTitle>Vilnius Login</CardTitle><CardDescription>Reikalingas pranešimams pateikti</CardDescription></div>
        {session.loggedIn
          ? <div className="flex items-center gap-2"><Badge variant="outline" className="border-success text-success"><ShieldCheck /> {session.name || 'Prisijungta'}</Badge><Button variant="outline" size="sm" onClick={logout}><LogOut /> Atsijungti</Button></div>
          : <Badge variant="outline" className={session.credsSaved ? 'border-warning text-warning' : 'border-destructive text-destructive'}>{session.credsSaved ? 'Bus naudojami išsaugoti duomenys' : 'Neprisijungta'}</Badge>}
      </CardHeader>
      {session.loggedIn ? (
        <CardContent className="text-sm text-muted-foreground">{session.remembered ? 'Likti prisijungus – sesija išsaugota serveryje.' : 'Sesija laikoma tik atmintyje iki programos perkrovimo.'}</CardContent>
      ) : (
        <CardContent className="space-y-5">
          <label className="flex items-start gap-2">
            <Checkbox checked={remember} onCheckedChange={v => setRem(!!v)} className="mt-0.5" />
            <span className="text-sm"><b>Likti prisijungus</b><br /><span className="text-muted-foreground">Pažymėta – sesijos raktas saugomas serveryje (ir po perkrovimo). Nepažymėta – tik atmintyje. Slaptažodis niekada neišsaugomas.</span></span>
          </label>
          <form onSubmit={login} className="space-y-3" autoComplete="on">
            <div className="text-sm font-medium">El. paštas ir slaptažodis</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="lu" className="text-xs text-muted-foreground">El. paštas</Label><Input id="lu" inputMode="email" autoComplete="username" value={user} onChange={e => setUser(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="lp" className="text-xs text-muted-foreground">Slaptažodis</Label><Input id="lp" type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} /></div>
            </div>
            <Button type="submit" disabled={busy || !user || !pass}>{busy ? <Loader2 className="animate-spin" /> : <LogIn />} {busy ? 'Jungiamasi prie Vilnius Login…' : 'Prisijungti'}</Button>
          </form>
          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-1 font-medium">Arba per naršyklę (kompiuteryje)</div>
            <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
              <li>Nutempkite į žymių juostą: <a href={bookmarklet} onClick={e => { e.preventDefault(); toast('Nutempkite šią nuorodą į žymių juostą, tada naudokite tvarkaumiesta.lt puslapyje.'); }} className="inline-flex items-center gap-1 rounded-full border border-success px-2 py-0.5 text-success no-underline"><Bookmark className="size-3" /> → Parking</a></li>
              <li>Prisijunkite <a className="text-primary hover:underline" href="https://tvarkaumiesta.lt" target="_blank" rel="noopener">tvarkaumiesta.lt</a> (Vilnius Login ar e. valdžios vartai).</li>
              <li>Ten paspauskite žymę – sesija bus perduota čia.</li>
            </ol>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ApplicantCard({ applicant, fields, reload }) {
  const [vals, setVals] = useState(applicant.app);
  const [busy, setBusy] = useState(false);
  useEffect(() => setVals(applicant.app), [applicant.app]);
  const save = async e => {
    e.preventDefault();
    setBusy(true);
    const r = await postJson('api/settings/applicant', vals);
    setBusy(false);
    r.ok ? toast.success('Pareiškėjo duomenys išsaugoti') : toast.error('Nepavyko išsaugoti');
    reload();
  };
  return (
    <Card id="set-applicant" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Pareiškėjo duomenys</CardTitle>
        <CardDescription>Siunčiami kartu su pranešimu. Tušti laukai imami iš Vilnius Login profilio, tada iš <code>applicant.json</code> secret. Čia įvesti turi pirmenybę.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3" autoComplete="on">
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(fields).map(([k, label]) => {
              const eff = applicant.values[k], own = vals?.[k] || '';
              return (
                <div key={k} className="space-y-1.5">
                  <Label className={cn('text-xs text-muted-foreground', !eff && !own && 'text-destructive')}>
                    {label}{!own && (eff ? ' (iš profilio / secret)' : ' – trūksta')}
                  </Label>
                  <Input value={own} placeholder={own ? '' : eff || ''} aria-invalid={!eff && !own} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} />
                </div>
              );
            })}
          </div>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Išsaugoti</Button>
        </form>
      </CardContent>
    </Card>
  );
}

const PROVIDER_ORDER = ['none', 'anthropic', 'claude-code', 'openai', 'gemini', 'custom'];
const PROVIDER_NOTE = {
  none: 'be AI, viską įvedate patys',
  anthropic: 'API raktas, mokama pagal naudojimą',
  'claude-code': 'claude -p su prenumeratos tokenu',
  openai: 'GPT modeliai su vaizdu',
  gemini: 'Google AI Studio raktas',
  custom: 'Ollama, LM Studio, OpenRouter…',
};

function AiCard({ ai, reload }) {
  const [pick, setPick] = useState(ai.provider);
  const p = ai.providers[pick];
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setModel(p?.model || ''); setBaseUrl(p?.baseUrl || ''); setKey(''); }, [pick, ai]);
  const label = id => (id === 'none' ? 'Rankinis' : ai.providers[id]?.label);

  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await postJson('api/settings/ai', { provider: pick, model, baseUrl, key });
      const j = await r.json();
      setKey('');
      r.ok ? toast.success(pick === 'none' ? 'Įjungtas rankinis režimas' : `${label(pick)} patikrintas ir išsaugotas`) : toast.error(j.error);
      reload();
    } finally { setBusy(false); }
  };
  const delKey = async () => { await fetch(`api/settings/ai-key/${pick}`, { method: 'DELETE' }); toast('Raktas pašalintas'); reload(); };

  const keyState = !p ? null : p.keySource === 'docker' ? `nustatytas Docker secret (${p.keyHint})` : p.keySource === 'app' ? `išsaugotas (${p.keyHint})` : p.keyOptional ? 'nebūtinas' : 'trūksta';

  return (
    <Card id="set-ai" className="scroll-mt-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Atpažinimas (AI)</CardTitle>
          <CardDescription>AI perskaito valst. numerį, atpažįsta pažeidimą ir pasiūlo aprašymą – jūs tik patikrinate. Be AI viskas veikia rankiniu režimu.</CardDescription></div>
        {ai.provider === 'none' ? <Badge variant="outline">Rankinis režimas</Badge>
          : ai.ready ? <Badge variant="outline" className="border-success text-success">Įjungta · {label(ai.provider)}</Badge>
          : <Badge variant="outline" className="border-destructive text-destructive">{label(ai.provider)}: trūksta {ai.missing.join(', ')}</Badge>}
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4" autoComplete="off">
          <RadioGroup value={pick} onValueChange={setPick} className="grid gap-2 sm:grid-cols-3">
            {PROVIDER_ORDER.map(id => (
              <Label key={id} htmlFor={`prov-${id}`} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 font-normal', pick === id && 'border-primary')}>
                <RadioGroupItem id={`prov-${id}`} value={id} className="mt-0.5" />
                <span><b>{label(id)}</b>{id === ai.provider && <Badge variant="secondary" className="ml-1">naudojamas</Badge>}<br /><span className="text-xs text-muted-foreground">{PROVIDER_NOTE[id]}</span></span>
              </Label>
            ))}
          </RadioGroup>
          {pick === 'none' ? (
            <p className="text-sm text-muted-foreground">Numerį ir pažeidimą įvesite patys. Jokie duomenys nesiunčiami trečiosioms šalims.</p>
          ) : p && (
            <div className="space-y-3">
              {p.needsBaseUrl && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Adresas (base URL), pvz. http://localhost:11434/v1</Label><Input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} aria-invalid={!baseUrl} placeholder="http://…/v1" /></div>}
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Modelis{p.defaultModel && ` (numatytas ${p.defaultModel})`}</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder={p.defaultModel || 'pvz. llava, qwen2.5vl'} aria-invalid={!model} /></div>
              <div className="space-y-1.5">
                <Label className={cn('text-xs text-muted-foreground', keyState === 'trūksta' && 'text-destructive')}><KeyRound className="size-3" /> Raktas – {keyState}. {p.keyHelp}</Label>
                <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={p.keySource ? 'Įveskite naują, jei norite pakeisti' : 'raktas'} aria-invalid={!p.keySource && !p.keyOptional && !key} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {busy ? (pick === 'claude-code' ? 'Tikrinama (iki minutės)…' : 'Tikrinama…') : pick === 'none' ? 'Išsaugoti' : 'Patikrinti ir išsaugoti'}</Button>
            {p?.keySource === 'app' && <Button type="button" variant="outline" onClick={delKey}><Trash2 /> Pašalinti raktą</Button>}
          </div>
        </form>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Kaip tai veikia ir kas siunčiama</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {[['📷', 'Nuotraukos', 'įkeliate kaip visada'], ['⚙️', 'Visada automatiškai', 'data, laikas, adresas iš EXIF/GPS'], ['✨', 'Su AI', 'perskaito numerį, atpažįsta pažeidimą'], ['✅', 'Jūs patikrinate', 'ir pateikiate']].map(([i, t, d]) => (
              <div key={t} className={cn('rounded-lg border p-3', i === '✨' && 'border-primary')}><div className="text-lg">{i}</div><b>{t}</b><div className="text-xs text-muted-foreground">{d}</div></div>
            ))}
          </div>
          <ul className="mt-3 ml-4 list-disc space-y-1 text-muted-foreground">
            <li><b>Claude API / OpenAI / Gemini:</b> iki 4 nuotraukų siunčiama tiekėjo API; mokama pagal naudojimą (~5–10 ct atvejui).</li>
            <li><b>Claude Code (headless):</b> konteineryje paleidžiamas <code>claude -p</code>; su prenumeratos tokenu (<code>claude setup-token</code>) naudojamas Claude Pro/Max limitas.</li>
            <li><b>OpenAI-suderinamas:</b> Ollama, LM Studio, OpenRouter ir kt. Vietinis modelis – nuotraukos neišeina iš jūsų tinklo.</li>
            <li>Raktai saugomi tik serveryje (<code>/data/keys</code>, 600); naršyklei rodomi tik paskutiniai 4 simboliai. Docker secret turi pirmenybę.</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
