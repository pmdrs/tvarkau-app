import { useRef, useState } from 'react';
import { ImagePlus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Stage, StageList, stepState } from '@/components/Stages';

// File picker + the analysis pipeline (upload → photos → grouping → address/AI per case).
export function Uploader({ ai, analysis, onAnalyze, onClear }) {
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [useAi, setUseAi] = useState(true);
  const running = analysis.phase === 'running';
  const aiOn = ai?.ready && useAi;

  const pick = list => setFiles([...list].filter(f => /^image\//.test(f.type) || /\.hei[cf]$/i.test(f.name)));
  const clear = () => { setFiles([]); if (input.current) input.current.value = ''; onClear(); };

  return (
    <Card>
      <CardContent className="space-y-4">
        <label
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files); }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/60 hover:bg-accent/40"
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <div className="text-sm font-medium">{files.length ? `Pasirinkta nuotraukų: ${files.length}` : 'Pasirinkite arba nutempkite nuotraukas'}</div>
          <div className="text-xs text-muted-foreground">JPG, HEIC · nuotraukos sugrupuojamos į atvejus pagal laiką ir vietą (EXIF)</div>
          <input ref={input} type="file" multiple accept="image/*,.heic,.heif" className="sr-only" onChange={e => pick(e.target.files)} disabled={running} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {ai?.ready ? (
            <div className="flex items-center gap-2">
              <Checkbox id="useAi" checked={useAi} onCheckedChange={v => setUseAi(!!v)} disabled={running} />
              <Label htmlFor="useAi" className="font-normal"><Sparkles className="size-4 text-primary" /> Atpažinti su {ai.providers[ai.provider]?.label}</Label>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Rankinis režimas – numerį ir pažeidimą pasirinksite patys. <a className="text-primary underline-offset-4 hover:underline" href="#nustatymai/ai">Įjungti AI</a></span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={clear} disabled={running}><Trash2 /> Išvalyti</Button>
            <Button onClick={() => onAnalyze(files, aiOn)} disabled={!files.length || running}><Wand2 /> Analizuoti</Button>
          </div>
        </div>

        {analysis.phase !== 'idle' && <Pipeline analysis={analysis} />}
      </CardContent>
    </Card>
  );
}

function Pipeline({ analysis: a }) {
  const failed = a.phase === 'error';
  const casesDone = a.cases.length;
  const at = a.phase === 'done' ? 5
    : a.groups == null ? (a.uploadPct < 1 ? 0 : 1)
    : casesDone < a.groups ? 3 : 4;
  const aiStage = Object.values(a.caseStages).includes('ai');
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-2">
      <StageList>
        <Stage state={stepState(0, at, failed)} label="Įkeliamos nuotraukos į serverį" detail={a.uploadPct < 1 ? `${Math.round(a.uploadPct * 100)} %` : null} progress={a.uploadPct} />
        <Stage state={stepState(1, at, failed)} label="Apdorojamos nuotraukos (HEIC → JPG, EXIF laikas ir GPS)"
          detail={a.photosTotal ? `${a.photosDone}/${a.photosTotal}` : null} progress={a.photosTotal ? a.photosDone / a.photosTotal : null} />
        <Stage state={stepState(2, at, failed)} label="Grupuojama į atvejus" detail={a.groups != null ? `atvejų: ${a.groups}` : null} />
        <Stage state={stepState(3, at, failed)} label={a.useAi ? `Nustatomi adresai ir ${aiStage ? `vyksta ${a.aiLabel} analizė` : `${a.aiLabel} analizė`}` : 'Nustatomi adresai'}
          detail={a.groups ? `${casesDone}/${a.groups}` : null} progress={a.groups ? casesDone / a.groups : null} />
        <Stage state={a.phase === 'done' ? 'done' : stepState(4, at, failed)} label="Paruošta patikrinti" />
      </StageList>
      {failed && <div className="pb-2 text-sm text-destructive">{a.error}</div>}
    </div>
  );
}
