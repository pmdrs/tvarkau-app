import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function Journal({ rows, loading, onReload }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pateikti pranešimai</CardTitle>
        <Button variant="outline" size="sm" onClick={onReload} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /> Atnaujinti</Button>
      </CardHeader>
      <CardContent>
        {loading && !rows ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8" />)}</div>
        ) : !rows?.length ? (
          <p className="text-sm text-muted-foreground">Dar nėra.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Pažeidimas</TableHead><TableHead>Adresas</TableHead><TableHead>Nr.</TableHead><TableHead>KET</TableHead><TableHead>Pranešimas</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{r.data_laikas}</TableCell>
                  <TableCell>{r.adresas}</TableCell>
                  <TableCell className="font-mono">{r.nr}</TableCell>
                  <TableCell>{r.ket}</TableCell>
                  <TableCell>{r.pranesimo_nr ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`https://tvarkaumiesta.lt/pranesimai/${r.pranesimo_nr}`} target="_blank" rel="noopener">{r.pranesimo_nr} <ExternalLink className="size-3" /></a> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
