import { useEffect, useState } from 'react'
import {
  useCreateGoogleSheetLink,
  useDeleteGoogleSheetLink,
  useDiscoverGoogleSheet,
  useManageGoogleSheetLinks,
  useManageGroups,
  useManageGoogleSheetRuns,
  useMathCenterTerms,
  useSetGoogleSheetLinkEnabled,
} from '@my239/shared'
import { Button, Card, CardContent, Input, Spinner } from '../../../design/ui'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'

// GoogleSheetsTab configures group conduit tabs and the term-level initials
// legend. Discovery goes through the backend so service-account access is
// checked before a link is stored.
export function GoogleSheetsTab({ centerId, activeTermId }: { centerId: number; activeTermId: number }) {
  const terms = useMathCenterTerms(centerId)
  const groups = useManageGroups(centerId)
  const links = useManageGoogleSheetLinks(centerId)
  const runs = useManageGoogleSheetRuns(centerId)
  const discover = useDiscoverGoogleSheet(centerId)
  const create = useCreateGoogleSheetLink(centerId)
  const setEnabled = useSetGoogleSheetLinkEnabled(centerId)
  const remove = useDeleteGoogleSheetLink(centerId)
  const [url, setURL] = useState('')
  const [termId, setTermId] = useState(activeTermId)
  const [groupId, setGroupId] = useState(0)
  const [linkKind, setLinkKind] = useState<'conduit' | 'initials_legend'>('conduit')
  const [sheetId, setSheetId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const availableTabs = (discover.data?.tabs ?? []).filter((tab) => {
    const title = tab.title.trim().toLowerCase()
    if (title === 'зп') return false
    return linkKind === 'initials_legend' ? title === 'расшифровка' : title !== 'расшифровка'
  })

  useEffect(() => {
    if (activeTermId > 0) setTermId(activeTermId)
  }, [activeTermId])

  const discoverTabs = () => {
    setError('')
    setSheetId(null)
    discover.mutate(url, { onError: () => setError('Не удалось прочитать вкладки. Проверьте доступ сервисного аккаунта.') })
  }

  const add = () => {
    if (!termId || sheetId == null || (linkKind === 'conduit' && !groupId)) return
    setError('')
    create.mutate({ term_id: termId, group_id: linkKind === 'conduit' ? groupId : 0, link_kind: linkKind, spreadsheet_url: url, sheet_id: sheetId }, {
      onSuccess: () => { setURL(''); setSheetId(null) },
      onError: () => setError('Не удалось сохранить связь таблицы.'),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <SectionHeader title="Google Sheets" description="Вкладки групп синхронизируются с кондуитом; «Расшифровка» только выгружается из my239. Вкладка ЗП исключена." />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted">
              Ссылка на Google Sheet
              <Input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            </label>
            <Button type="button" variant="secondary" disabled={!url.trim() || discover.isPending} onClick={discoverTabs}>
              Найти вкладки
            </Button>
          </div>
          {discover.data ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Период
                <select className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink" value={termId} onChange={(event) => { setTermId(Number(event.target.value)); setGroupId(0) }}>
                  <option value={0}>Выберите период</option>
                  {(terms.data ?? []).map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Назначение
                <select className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink" value={linkKind} onChange={(event) => { setLinkKind(event.target.value as 'conduit' | 'initials_legend'); setGroupId(0); setSheetId(null) }}>
                  <option value="conduit">Кондуит группы</option>
                  <option value="initials_legend">Расшифровка (только my239 → Sheets)</option>
                </select>
              </label>
              {linkKind === 'conduit' ? (
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Группа
                  <select className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink" value={groupId} onChange={(event) => setGroupId(Number(event.target.value))}>
                    <option value={0}>Выберите группу</option>
                    {(groups.data ?? []).filter((group) => group.term_id === termId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="flex min-w-48 flex-col gap-1 text-xs text-muted">
                Вкладка
                <select className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink" value={sheetId ?? ''} onChange={(event) => setSheetId(Number(event.target.value))}>
                  <option value="">Выберите вкладку</option>
                  {availableTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.title}</option>)}
                </select>
              </label>
              <Button type="button" disabled={!termId || sheetId == null || (linkKind === 'conduit' && !groupId) || create.isPending} onClick={add}>Связать</Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <SectionHeader title="Связанные вкладки" description="Отключённые вкладки не участвуют в ручной или автоматической синхронизации." />
          {links.isPending ? <Spinner /> : links.isError ? <p className="text-sm text-danger">Не удалось загрузить связи.</p> : links.data?.length === 0 ? <p className="text-sm text-muted">Пока нет связанных вкладок.</p> : (
            <ul className="flex flex-col gap-2">
              {links.data?.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted px-3 py-2">
                  <span className="mr-auto text-sm text-ink">{link.sheet_title}</span>
                  <span className="text-xs text-muted">{link.link_kind === 'initials_legend' ? 'Расшифровка · только my239 → Sheets' : (link.group_name ?? 'группа не задана')}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={setEnabled.isPending} onClick={() => setEnabled.mutate({ linkId: link.id, enabled: !link.enabled })}>{link.enabled ? 'Отключить' : 'Включить'}</Button>
                  <ConfirmButton variant="ghost" size="sm" disabled={remove.isPending} onConfirm={() => remove.mutate(link.id)}>Удалить</ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <SectionHeader title="История синхронизаций" description="Время Google относится ко всей книге, а не к отдельной ячейке." />
          {runs.isPending ? <Spinner /> : runs.data?.length ? runs.data.slice(0, 5).map((run) => <p key={run.id} className="text-sm text-muted">{run.status === 'failed' ? 'Ошибка: ' + run.error_message : run.status} · {new Date(run.started_at).toLocaleString('ru-RU')}</p>) : <p className="text-sm text-muted">Синхронизаций ещё не было.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
