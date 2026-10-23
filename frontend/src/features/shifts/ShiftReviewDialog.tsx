import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftApi } from '@/lib/api/endpoints';
import type { Shift } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ShiftFigures, ShiftStatusBadge } from './ShiftParts';
import { varianceKind } from './shiftLogic';

export function ShiftReviewDialog({ shift: initial, onClose }: { shift: Shift; onClose: () => void }) {
  const qc = useQueryClient();
  const [shift, setShift] = useState(initial);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () => shiftApi.review(shift.id, note.trim() ? { note: note.trim() } : {}),
    onSuccess: (updated) => {
      setShift(updated);
      void qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });

  const hasVariance = varianceKind(shift.variance) === 'over' || varianceKind(shift.variance) === 'short';

  return (
    <Modal title={`Shift ${shift.doc_number}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        <ShiftStatusBadge status={shift.status} />
        <ShiftFigures shift={shift} />

        {shift.status === 'closed' && (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-medium">Tinjau shift</h3>
            {hasVariance && <p className="text-sm text-amber-800">Shift ini memiliki selisih kas. Periksa keterangan kasir sebelum menandai ditinjau.</p>}
            <ErrorNotice error={mutation.error} />
            <Field label="Catatan tinjauan (opsional)" hint="Tercatat di audit log.">
              <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => { if (!mutation.isPending) mutation.mutate(); }}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Menyimpan…' : 'Tandai sudah ditinjau'}
            </button>
          </div>
        )}
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Tutup</button>
      </div>
    </Modal>
  );
}
