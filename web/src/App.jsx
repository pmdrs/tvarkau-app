import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Settings as Gear, ShieldCheck, Sparkles, UserRound, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CaseCard, CaseSkeleton } from '@/components/CaseCard';
import { Journal } from '@/components/Journal';
import { Settings } from '@/components/Settings';
import { Uploader } from '@/components/Uploader';
import { getJson, postJson, uploadStream } from '@/lib/api';
import { cn } from '@/lib/utils';

const IDLE = { phase: 'idle', cases: [], caseStages: {} };
const readRoute = () => {
  const m = location.hash.match(/^#nustatymai(?:\/(\w+))?/);
  return m ? { view: 'settings', focus: m[1] || null } : { view: 'main', focus: null };
};

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [journal, setJournal] = useState(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [route, setRoute] = useState(readRoute);
  const [analysis, setAnalysis] = useState(IDLE);

  const loadStatus = useCallback(async () => setStatus(await getJson('api/status')), []);
  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    try { setJournal(await getJson('api/journal')); } finally { setJournalLoading(false); }
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    (async () => {
      setCfg(await getJson('api/config'));
      // Session handed over by the "→ Parking" bookmarklet (URL fragment, never sent to a server).
      const m = location.hash.match(/^#import=(.+)$/);
      if (m) {
        history.replaceState(null, '', location.pathname);
        try {
          const user = JSON.parse(decodeURIComponent(m[1]));
          const remember = (() => { try { return localStorage.getItem('tvarkau-remember') === '1'; } catch { return false; } })();
          const j = await (await postJson('api/session/import', { user, remember })).json();
          j.ok ? toast.success(`Prisijungta: ${j.name || ''}`) : toast.error(j.error);
        } catch { toast.error('Netinkami sesijos duomenys'); }
      }
      loadStatus();
      loadJournal();
    })();
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadStatus, loadJournal]);

  const go = hash => { location.hash = hash; };

  const analyze = async (files, useAi) => {
    const aiLabel = status?.ai.providers[status.ai.provider]?.label || 'AI';
    setAnalysis({ ...IDLE, phase: 'running', uploadPct: 0, photosDone: 0, photosTotal: 0, groups: null, groupPhotos: [], useAi, aiLabel, batchId: null });
    const fd = new FormData();
    fd.append('ai', useAi ? '1' : '0');
    for (const f of files) fd.append('photos', f, f.name);
    const on = ev => setAnalysis(a => {
      switch (ev.type) {
        case 'batch': return { ...a, batchId: ev.batchId, photosTotal: ev.total };
        case 'photo': return { ...a, photosDone: ev.done, photosTotal: ev.total };
        case 'groups': return { ...a, groups: ev.count, groupPhotos: ev.photoIdx };
        case 'case-stage': return { ...a, caseStages: { ...a.caseStages, [ev.id]: ev.stage } };
        case 'case': return { ...a, cases: [...a.cases, ev.case], caseStages: { ...a.caseStages, [ev.case.id]: 'done' } };
        case 'done': return { ...a, phase: 'done' };
        case 'error': return { ...a, phase: 'error', error: ev.error };
        default: return a;
      }
    });
    try {
      await uploadStream('api/analyze', fd, { onUpload: pct => setAnalysis(a => ({ ...a, uploadPct: pct })), onEvent: on });
    } catch (e) {
      setAnalysis(a => ({ ...a, phase: 'error', error: e.message }));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Tvarkau miestą – stovėjimo pažeidimai</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chips status={status} go={go} />
          <Button variant="outline" size="sm" onClick={() => go('#nustatymai')} className="relative">
            <Gear /> Nustatymai
            {status?.missing.length > 0 && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-destructive ring-2 ring-background" />}
          </Button>
        </div>
      </header>

      {route.view === 'settings' ? (
        <Settings status={status} cfg={cfg || { applicantFields: {} }} focus={route.focus} onBack={() => go('')} reload={loadStatus} />
      ) : (
        <>
          {status?.missing.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Trūksta nustatymų</AlertTitle>
              <AlertDescription><ul className="ml-4 list-disc">{status.missing.map(m => <li key={m.area}><a href={`#nustatymai/${m.area}`} className="underline">{m.text}</a></li>)}</ul></AlertDescription>
            </Alert>
          )}
          {!status || !cfg ? <Skeleton className="h-52 rounded-xl" /> : (
            <Uploader ai={status.ai} analysis={analysis} onAnalyze={analyze} onClear={() => setAnalysis(IDLE)} />
          )}
          {cfg && analysis.groups > 0 && Array.from({ length: analysis.groups }, (_, i) => {
            const c = analysis.cases.find(x => x.id === i);
            return c
              ? <CaseCard key={`${analysis.batchId}-${i}`} c={c} batchId={analysis.batchId} cfg={cfg} status={status} onSubmitted={loadJournal} onNeedsLogin={() => { loadStatus(); go('#nustatymai/vilnius'); }} />
              : <CaseSkeleton key={`${analysis.batchId}-${i}`} index={i} photoIdx={analysis.groupPhotos[i] || []} batchId={analysis.batchId} stage={analysis.caseStages[i]} useAi={analysis.useAi} aiLabel={analysis.aiLabel} />;
          })}
          <Journal rows={journal} loading={journalLoading} onReload={loadJournal} />
        </>
      )}
    </div>
  );
}

function Chips({ status, go }) {
  if (!status) return <><Skeleton className="h-6 w-28 rounded-full" /><Skeleton className="h-6 w-24 rounded-full" /></>;
  const { session, ai, applicant } = status;
  const chip = (cls, Icon, text, area, title) => (
    <Badge key={area} variant="outline" title={title} onClick={() => go(`#nustatymai/${area}`)} className={cn('cursor-pointer', cls)}><Icon /> {text}</Badge>
  );
  const ok = 'border-success text-success', bad = 'border-destructive text-destructive', mid = 'border-warning text-warning';
  const aiLabel = ai.providers[ai.provider]?.label;
  return (
    <>
      {session.loggedIn ? chip(ok, ShieldCheck, session.name || 'Prisijungta', 'vilnius')
        : session.credsSaved ? chip(mid, ShieldCheck, 'Vilnius: išsaugoti duomenys', 'vilnius', 'Prisijungs pateikiant') : chip(bad, XCircle, 'Neprisijungta', 'vilnius')}
      {ai.provider === 'none' ? chip('', Sparkles, 'Rankinis režimas', 'ai')
        : ai.ready ? chip(ok, Sparkles, aiLabel, 'ai', ai.providers[ai.provider].model) : chip(bad, Sparkles, `${aiLabel}: trūksta`, 'ai')}
      {applicant.missing.length ? chip(bad, UserRound, `Pareiškėjas: trūksta ${applicant.missing.length}`, 'applicant', applicant.missing.join(', ')) : chip(ok, UserRound, 'Pareiškėjas', 'applicant')}
    </>
  );
}
