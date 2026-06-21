import { useState } from 'react'
import {
  formatDateTime,
  isClosed,
  useSeriesSolutionTex,
  usePutSeriesSolutionTex,
  useSetSeriesSolutionLink,
  useUploadSeriesSolutionPdf,
  type Series,
} from '@my239/shared'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../design/ui'
import { SolutionContent } from './solution-content'
import { SolutionEditor } from './solution-editor'

// SeriesSolutionPanel shows a series' «Разбор» (official solutions). Students
// see it only once the deadline has passed; teachers always, plus an authoring
// button. Rendered full-width below the series detail.
export function SeriesSolutionPanel({
  series,
  isManager,
}: {
  series: Series
  isManager: boolean
}) {
  const [show, setShow] = useState(false)
  const texQuery = useSeriesSolutionTex(series.id, series.has_solution_tex && show)
  const putTex = usePutSeriesSolutionTex(series.id)
  const uploadPdf = useUploadSeriesSolutionPdf(series.id)
  const setLink = useSetSeriesSolutionLink(series.id)

  const hasAny =
    series.has_solution_tex || series.has_solution_pdf || !!series.solution_link
  const releasedToStudents = isClosed(series.due_at)
  // Students can't see the разбор before the deadline; nothing to render then.
  if (!isManager && (!releasedToStudents || !hasAny)) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Разбор</CardTitle>
        <div className="flex items-center gap-2">
          {isManager ? (
            <SolutionEditor
              title={'Разбор · ' + series.display_name}
              hasTex={series.has_solution_tex}
              hasPdf={series.has_solution_pdf}
              link={series.solution_link}
              onPutTex={(tex) => putTex.mutateAsync(tex)}
              onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
              onSetLink={(link) => setLink.mutateAsync(link)}
              trigger={
                <Button type="button" size="sm" variant="secondary">
                  Загрузить разбор
                </Button>
              }
            />
          ) : null}
          {hasAny ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>
              {show ? 'Скрыть' : 'Показать'}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {isManager ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted">
            {releasedToStudents
              ? 'Разбор виден ученикам — дедлайн серии прошёл.'
              : 'Можно загрузить заранее: ученики увидят разбор только после дедлайна (' +
                formatDateTime(series.due_at) +
                ').'}
          </p>
        </CardContent>
      ) : null}
      {show && hasAny ? (
        <CardContent>
          <SolutionContent
            hasTex={series.has_solution_tex}
            hasPdf={series.has_solution_pdf}
            link={series.solution_link}
            pdfPath={'/mathcenter/series/' + series.id + '/solution/pdf'}
            texQuery={texQuery}
          />
        </CardContent>
      ) : !hasAny && isManager ? (
        <CardContent>
          <p className="text-sm text-muted">
            Разбор ещё не загружен. Нажмите «Загрузить разбор».
          </p>
        </CardContent>
      ) : null}
    </Card>
  )
}
