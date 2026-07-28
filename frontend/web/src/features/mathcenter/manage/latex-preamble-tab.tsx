import { useEffect, useState } from 'react'
import {
  DEFAULT_LATEX_PREAMBLE,
  useMathCenterLatexPreamble,
  useUpdateMathCenterLatexPreamble,
} from '@my239/shared'
import { Button, Card, CardContent, Spinner, Textarea } from '../../../design/ui'
import { SectionHeader } from '../../admin/_shared'

export function LatexPreambleTab({ centerId }: { centerId: number }) {
  const preamble = useMathCenterLatexPreamble(centerId)
  const update = useUpdateMathCenterLatexPreamble(centerId)
  const [value, setValue] = useState(DEFAULT_LATEX_PREAMBLE)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (preamble.data?.preamble) setValue(preamble.data.preamble)
  }, [preamble.data?.preamble])

  function save() {
    setError(null)
    setSaved(false)
    update.mutate(value, {
      onSuccess: () => setSaved(true),
      onError: () => setError('Не удалось сохранить преамбулу.'),
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader
          title="Преамбула LaTeX"
          description="Она автоматически добавляется к тексту без \\documentclass и \\begin{document}. Оставьте полную преамбулу с \\documentclass; маркеры тела сюда добавлять не нужно."
        />
        {preamble.isPending ? <Spinner /> : null}
        {preamble.isError ? <p className="text-sm text-danger">Не удалось загрузить преамбулу.</p> : null}
        <Textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setSaved(false)
          }}
          className="min-h-[32rem] font-mono text-xs leading-6"
          aria-label="Преамбула LaTeX"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={update.isPending || value.trim() === ''} onClick={save}>
            {update.isPending ? 'Сохраняем…' : 'Сохранить преамбулу'}
          </Button>
          <Button type="button" variant="ghost" disabled={update.isPending} onClick={() => { setValue(DEFAULT_LATEX_PREAMBLE); setSaved(false) }}>
            Вернуть стандартную
          </Button>
          {saved ? <span className="text-sm text-status-accepted">Сохранено.</span> : null}
        </div>
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
