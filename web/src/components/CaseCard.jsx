import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, RefreshCw, Send, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { LazyImage } from '@/components/LazyImage';
import { Stage, StageList, stepState } from '@/components/Stages';
import { postJson, postStream } from '@/lib/api';
import { cn } from '@/lib/utils';

const PLATE_RE = /^[A-Z0-9]{2,8}$/;
const ageDays = t => (t ? Math.floor((Date.now() - new Date(t.replace(' ', 'T'))) / 864e5) : null);
const SUBMIT_STAGES = ['session', 'upload', 'id', 'archive'];

const Field = ({ label, invalid, children, className }) => (
  <div className={cn('space-y-1.5', className)}>
    <Label className={cn('text-xs text-muted-foreground', invalid && 'text-destructive')}>{label}</Label>
    {children}
  </div>
);

// Placeholder while the server is still geocoding / asking the AI about this case.
export function CaseSkeleton({ index, photoIdx, batchId, stage, useAi, aiLabel }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">Atvejis {index + 1} <Skeleton className="h-4 w-40" /></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Thumbs batchId={batchId} photoIdx={photoIdx} />
        <StageList className="rounded-lg border bg-muted/30 px-4 py-1">
          <Stage state={stage === 'geocode' ? 'active' : stage ? 'done' : 'pending'} label="Nustatomas adresas pagal GPS" />
          {useAi && <Stage state={stage === 'ai' ? 'active' : 'pending'} label={`${aiLabel} skaito valst. numerį ir pažeidimą`} detail={stage === 'ai' ? 'gali užtrukti iki minutės' : null} />}
        </StageList>
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9" />)}</div>
        <Skeleton className="h-24" />
      </CardContent>
    </Card>
  );
}

function Thumbs({ batchId, photoIdx, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {photoIdx.map(i => {
        const on = !selected || selected.includes(i);
        return (
          <label key={i} className={cn('relative block size-28 cursor-pointer', !on && 'opacity-40')}>
            <LazyImage src={`api/photo/${batchId}/${i}`} className="size-28 ring-1 ring-border" />
            {onToggle && <Checkbox checked={on} onCheckedChange={() => onToggle(i)} className="absolute top-1.5 left-1.5 bg-background/80" />}
          </label>
        );
      })}
    </div>
  );
}

export function CaseCard({ c, batchId, cfg, status, onSubmitted, onNeedsLogin }) {
  const [d0, t0] = (c.time || '').split(' ');
  const [date, setDate] = useState(d0 || '');
  const [time, setTime] = useState(t0 || '');
  const [address, setAddress] = useState(c.address || '');
  const [plate, setPlate] = useState(c.plate || '');
  const [viols, setViols] = useState(c.violations || []);
  const [extra, setExtra] = useState(c.extra || '');
  const [desc, setDesc] = useState(c.description || '');
  const [photos, setPhotos] = useState(c.photoIdx);
  const [ack, setAck] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submit, setSubmit] = useState({ phase: 'idle' }); // idle | running | done | error

  const dt = `${date} ${time}`;
  const plateVal = plate.toUpperCase().replace(/\s+/g, '');
  const age = ageDays(date && time ? dt : null);
  const tooOld = age != null && age > cfg.maxAgeDays;

  const need = useMemo(() => {
    const n = [];
    if (!date) n.push('data');
    if (!time) n.push('laikas');
    if (!address.trim()) n.push('adresas');
    if (!PLATE_RE.test(plateVal)) n.push('valstybinis numeris');
    if (!desc.trim()) n.push('aprašymas');
    if (!photos.length) n.push('bent viena nuotrauka');
    if (tooOld && !ack) n.push('patvirtinimas dėl 30 d. ribos');
    return n;
  }, [date, time, address, plateVal, desc, photos, tooOld, ack]);

  const soft = [];
  if (!viols.length) soft.push('nepažymėtas nė vienas pažeidimas');
  if (status && !status.session.loggedIn && !status.session.credsSaved) soft.push(<a key="v" href="#nustatymai/vilnius" className="underline">neprisijungta prie Vilnius Login</a>);
  if (status?.applicant.missing.length) soft.push(<a key="a" href="#nustatymai/applicant" className="underline">trūksta pareiškėjo duomenų: {status.applicant.missing.join(', ')}</a>);

  const regen = async () => {
    const r = await postJson('api/describe', { time: dt, address, plate: plateVal, violations: viols, extra, photoCount: photos.length });
    setDesc((await r.json()).description);
  };
  // Keep the description in step with the fields until the user edits it by hand.
  const [descTouched, setDescTouched] = useState(false);
  useEffect(() => { if (!descTouched && !c.pending) regen(); /* eslint-disable-next-line */ }, [viols, plateVal, photos.length]);

  const doSubmit = async () => {
    setConfirmOpen(false);
    setSubmit({ phase: 'running', at: 0 });
    await postStream('api/submit', {
      batchId, caseId: c.id, time: dt, address, lat: c.lat, lon: c.lon, plate: plateVal,
      description: desc, photoIdx: photos, violations: viols, ackOld: ack,
    }, ev => {
      if (ev.type === 'stage') setSubmit(s => ({ ...s, at: SUBMIT_STAGES.indexOf(ev.stage) }));
      if (ev.type === 'done') { setSubmit({ phase: 'done', at: 4, result: ev }); onSubmitted?.(); }
      if (ev.type === 'error') {
        setSubmit(s => ({ phase: 'error', at: s.at ?? 0, error: ev.error }));
        if (ev.needsLogin) onNeedsLogin?.();
      }
    }).catch(e => setSubmit(s => ({ phase: 'error', at: s.at ?? 0, error: e.message })));
  };

  const done = submit.phase === 'done';
  const busy = submit.phase === 'running';
  const locked = busy || done;
  const toggleViol = k => setViols(v => (v.includes(k) ? v.filter(x => x !== k) : [...v, k]));

  return (
    <Card className={cn(done && 'border-success/50')}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Atvejis {c.id + 1}{c.vehicle && <span className="font-normal text-muted-foreground">– {c.vehicle}</span>}
          {done && <Badge className="bg-success text-white"><CheckCircle2 /> Pateikta</Badge>}
        </CardTitle>
        {c.lat != null
          ? <a className="flex items-center gap-1 text-sm text-primary hover:underline" href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=19/${c.lat}/${c.lon}`} target="_blank" rel="noopener"><MapPin className="size-4" /> žemėlapis</a>
          : <span className="text-sm text-muted-foreground">be GPS</span>}
      </CardHeader>
      <CardContent className="space-y-4">
        <Thumbs batchId={batchId} photoIdx={c.photoIdx} selected={photos} onToggle={locked ? null : i => setPhotos(p => (p.includes(i) ? p.filter(x => x !== i) : [...p, i]))} />

        {c.aiError && <Alert variant="destructive"><AlertTriangle /><AlertDescription>{c.aiError}</AlertDescription></Alert>}
        {c.manual && <Note>Rankinis režimas: įveskite numerį ir pažymėkite pažeidimus – aprašymas susidarys pats.</Note>}
        {c.noExif && <Note>Nuotraukose nėra EXIF laiko ir vietos – įveskite ranka.</Note>}
        {c.doubts && <Note icon={Sparkles}>AI abejonės: {c.doubts}</Note>}
        {!c.plateCertain && c.plate && <Note icon={Sparkles}>Numerį patikrinkite – AI nėra tikras.</Note>}

        {tooOld ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Šio pranešimo VMSA nenagrinės</AlertTitle>
            <AlertDescription>
              Pažeidimas užfiksuotas prieš {age} d., o pagal naują savivaldybės reglamentą pranešimas turi būti pateiktas per {cfg.maxAgeDays} d.
              <label className="mt-2 flex items-center gap-2 text-foreground"><Checkbox checked={ack} onCheckedChange={v => setAck(!!v)} disabled={locked} /> Suprantu ir vis tiek teikiu</label>
            </AlertDescription>
          </Alert>
        ) : age != null && !Number.isNaN(age) && (
          <div className="text-sm text-muted-foreground">Pažeidimui {age} d. – iki {cfg.maxAgeDays} d. ribos liko {cfg.maxAgeDays - age} d.</div>
        )}

        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pažeidimo data" invalid={!date}><Input type="date" value={date} onChange={e => setDate(e.target.value)} aria-invalid={!date} /></Field>
            <Field label="Laikas" invalid={!time}><Input type="time" value={time} onChange={e => setTime(e.target.value)} aria-invalid={!time} /></Field>
          </div>
          <Field label="Adresas" invalid={!address.trim()}><Input value={address} onChange={e => setAddress(e.target.value)} aria-invalid={!address.trim()} /></Field>
          <Field label="Valstybinis numeris" invalid={!PLATE_RE.test(plateVal)}>
            <Input value={plate} onChange={e => setPlate(e.target.value)} aria-invalid={!PLATE_RE.test(plateVal)} className="max-w-48 font-bold tracking-widest uppercase" />
          </Field>
          <Field label="Pažeidimai" invalid={!viols.length}>
            <div className={cn('grid gap-2 rounded-md p-1 sm:grid-cols-2', !viols.length && 'ring-1 ring-destructive/50')}>
              {Object.entries(cfg.violations).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={viols.includes(k)} onCheckedChange={() => toggleViol(k)} /> {v.label} <span className="text-xs text-muted-foreground">({v.ket} p.)</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Papildoma aplinkybė (nebūtina)"><Input value={extra} onChange={e => setExtra(e.target.value)} onBlur={() => !descTouched && regen()} /></Field>
          <Field label="Aprašymas" invalid={!desc.trim()}>
            <Textarea value={desc} maxLength={1000} rows={5} onChange={e => { setDesc(e.target.value); setDescTouched(true); }} aria-invalid={!desc.trim()} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Liko simbolių: {1000 - desc.length}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setDescTouched(false); regen(); }}><RefreshCw /> Perrašyti pagal laukus</Button>
            </div>
          </Field>
        </fieldset>

        {!locked && need.length > 0 && <Alert variant="destructive"><AlertDescription>Užpildykite: {need.join(', ')}</AlertDescription></Alert>}
        {!locked && soft.length > 0 && <Note>Atkreipkite dėmesį: {soft.reduce((acc, x, i) => [...acc, i ? '; ' : '', x], [])}</Note>}

        {submit.phase !== 'idle' && (
          <StageList className="rounded-lg border bg-muted/30 px-4 py-1">
            <Stage state={stepState(0, submit.at, submit.phase === 'error')} label="Tikrinama Vilnius Login sesija" />
            <Stage state={stepState(1, submit.at, submit.phase === 'error')} label={`Įkeliamas pranešimas ir ${photos.length} nuotr. į tvarkaumiesta.lt`} />
            <Stage state={stepState(2, submit.at, submit.phase === 'error')} label="Gaunamas pranešimo numeris" />
            <Stage state={stepState(3, submit.at, submit.phase === 'error')} label="Išsaugoma archyve ir žurnale" />
          </StageList>
        )}
        {submit.phase === 'error' && <Alert variant="destructive"><AlertTriangle /><AlertDescription>{submit.error}</AlertDescription></Alert>}
        {done && (
          <Alert className="border-success/50 text-success">
            <CheckCircle2 />
            <AlertTitle>Užregistruota{submit.result.id ? `: pranešimas ${submit.result.id}` : ''}</AlertTitle>
            <AlertDescription>
              {submit.result.url && <a className="inline-flex items-center gap-1 underline" href={submit.result.url} target="_blank" rel="noopener">Atidaryti tvarkaumiesta.lt <ExternalLink className="size-3" /></a>}
              <span className="text-muted-foreground">Išsaugota: {submit.result.folder}</span>
            </AlertDescription>
          </Alert>
        )}

        {!done && (
          <Button onClick={() => setConfirmOpen(true)} disabled={busy || need.length > 0} className="w-full sm:w-auto">
            <Send /> {busy ? 'Teikiama…' : submit.phase === 'error' ? 'Bandyti dar kartą' : 'Pateikti į tvarkaumiesta.lt'}
          </Button>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Pateikti pranešimą?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <div><b className="text-foreground">{plateVal}</b> · {dt} · {address} · {photos.length} nuotr.</div>
                  <div className="rounded-md bg-muted p-2 text-foreground">{desc}</div>
                  {tooOld && <div className="text-destructive">⚠ VMSA šio pranešimo nenagrinės ({age} d.).</div>}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Atšaukti</AlertDialogCancel>
              <AlertDialogAction onClick={doSubmit}><Send /> Pateikti</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function Note({ children, icon: Icon = AlertTriangle }) {
  return (
    <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>{children}</div>
    </div>
  );
}
