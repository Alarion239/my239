import { useEffect, useState } from 'react'
import {
  useGoogleSheetConfig,
  useCreateGoogleSheetLink,
  useDeleteGoogleSheetLink,
  useDiscoverGoogleSheet,
  useManageGoogleSheetLinks,
  useManageGroups,
  useManageGoogleSheetRuns,
  useMathCenterTerms,
  useSetGoogleSheetLinkEnabled,
  useSyncGoogleSheetSeries,
  useSyncGoogleSheetStudents,
  isUnallocatedGroup,
} from '@my239/shared'
import { Button, Input, Spinner } from '../../../design/ui'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'

// GoogleSheetsTab configures group conduit tabs and the term-level initials
// legend. Discovery goes through the backend so service-account access is
// checked before a link is stored.
export function GoogleSheetsTab({ centerId, activeTermId }: { centerId: number; activeTermId: number }) {
  const terms = useMathCenterTerms(centerId)
  const serviceAccount = useGoogleSheetConfig(centerId)
  const links = useManageGoogleSheetLinks(centerId)
  const runs = useManageGoogleSheetRuns(centerId)
  const discover = useDiscoverGoogleSheet(centerId)
  const create = useCreateGoogleSheetLink(centerId)
  const setEnabled = useSetGoogleSheetLinkEnabled(centerId)
  const remove = useDeleteGoogleSheetLink(centerId)
  const syncStudents = useSyncGoogleSheetStudents(centerId)
  const syncSeries = useSyncGoogleSheetSeries(centerId)
  const [url, setURL] = useState('')
  const [termId, setTermId] = useState(activeTermId)
  const [groupId, setGroupId] = useState(0)
  const [linkKind, setLinkKind] = useState<'conduit' | 'initials_legend'>('conduit')
  const [sheetId, setSheetId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const [accountEmailCopied, setAccountEmailCopied] = useState(false)
  const groups = useManageGroups(centerId, termId)
  const visibleRuns = (runs.data ?? []).filter((run) => run.error_message !== 'google sheets conduit parser is not configured')

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
      onSuccess: () => { setGroupId(0); setSheetId(null) },
      onError: () => setError('Не удалось сохранить связь таблицы.'),
    })
  }

  const synchronizeStudents = () => {
    if (!termId) return
    setSyncMessage('')
    setSyncError('')
    syncStudents.mutate(termId, {
      onSuccess: (result) => setSyncMessage(
        `Ученики: добавлено в my239 — ${result.added_to_my239}` +
        (result.read_only ? '' : `, в Google Sheets — ${result.added_to_sheets}`) +
        `, совпало — ${result.matched}` +
        (result.moved > 0 ? `, перенесено в связанную группу — ${result.moved}` : '') +
        (result.ambiguous > 0 ? `, пропущено неоднозначных имён — ${result.ambiguous}` : '') +
        (result.read_only ? '. Таблица доступна только для чтения: импорт выполнен, запись в Google Sheets не производилась.' : ''),
      ),
      onError: () => setSyncError('Не удалось синхронизировать учеников. Проверьте связанные вкладки и доступ к таблице.'),
    })
  }

  const synchronizeSeries = () => {
    if (!termId) return
    setSyncMessage('')
    setSyncError('')
    syncSeries.mutate(termId, {
      onSuccess: (result) => setSyncMessage(
        `Серии: добавлено в my239 — ${result.added_to_my239}` +
        (result.read_only ? '' : `, в Google Sheets — ${result.added_to_sheets}`) +
        `, найдено в таблицах — ${result.matched}.` +
        (result.read_only ? ' Таблица доступна только для чтения: импорт выполнен, запись в Google Sheets не производилась.' : ''),
      ),
      onError: () => setSyncError('Не удалось синхронизировать серии. Проверьте разметку связанных вкладок и доступ к таблице.'),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader
            title="Адрес service account для доступа к таблице"
            description="Скопируйте этот адрес и добавьте его в Google Sheets через «Настройки доступа». Роли «Читатель» достаточно для одностороннего импорта; «Редактор» нужен только для записи обратно."
          />
          {serviceAccount.isPending ? <Spinner /> : serviceAccount.data?.service_account_email ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={serviceAccount.data.service_account_email}
                onFocus={(event) => event.target.select()}
                aria-label="Адрес service account"
                className="min-w-64 flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(serviceAccount.data.service_account_email).then(() => {
                    setAccountEmailCopied(true)
                    window.setTimeout(() => setAccountEmailCopied(false), 1500)
                  }).catch(() => setAccountEmailCopied(false))
                }}
              >
                {accountEmailCopied ? 'Скопировано' : 'Копировать адрес'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">Адрес service account пока не настроен на backend.</p>
          )}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader title="Google Sheets" description="Свяжите вкладку таблицы с группой или «Расшифровкой»." />
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
                <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text" value={termId} onChange={(event) => { setTermId(Number(event.target.value)); setGroupId(0) }}>
                  <option value={0}>Выберите период</option>
                  {(terms.data ?? []).map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Назначение
                <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text" value={linkKind} onChange={(event) => { setLinkKind(event.target.value as 'conduit' | 'initials_legend'); setGroupId(0); setSheetId(null) }}>
                  <option value="conduit">Кондуит группы</option>
                  <option value="initials_legend">Расшифровка (только my239 → Sheets)</option>
                </select>
              </label>
              {linkKind === 'conduit' ? (
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Группа
                  <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text" value={groupId} onChange={(event) => setGroupId(Number(event.target.value))}>
                    <option value={0}>Выберите группу</option>
                    {(groups.data ?? []).filter((group) => !isUnallocatedGroup(group.name)).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="flex min-w-48 flex-col gap-1 text-xs text-muted">
                Вкладка
                <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text" value={sheetId ?? ''} onChange={(event) => setSheetId(Number(event.target.value))}>
                  <option value="">Выберите вкладку</option>
                  {availableTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.title}</option>)}
                </select>
              </label>
              <Button type="button" disabled={!termId || sheetId == null || (linkKind === 'conduit' && !groupId) || create.isPending} onClick={add}>Связать</Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader title="Как подключить" />
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-text">
            <li>
              В Google Sheets откройте «Настройки доступа» и добавьте адрес service account выше. Выберите «Читатель» для безопасного одностороннего импорта или «Редактор» для двусторонней синхронизации.
            </li>
            <li>
              Вставьте ссылку на таблицу и нажмите «Найти вкладки».
            </li>
            <li>
              Выберите период, группу и вкладку, затем нажмите «Связать». «Расшифровка» подключается отдельно.
            </li>
          </ol>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader
            title="Синхронизация структуры"
            description="Импортирует данные из включённых вкладок выбранного периода. Если таблица доступна для редактирования, недостающие данные также добавляются в неё; ничего не удаляется."
          />
          <label className="flex w-fit flex-col gap-1 text-xs text-muted">
            Период
            <select
              className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
              value={termId}
              onChange={(event) => setTermId(Number(event.target.value))}
            >
              <option value={0}>Выберите период</option>
              {(terms.data ?? []).map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!termId || syncStudents.isPending || syncSeries.isPending}
              onClick={synchronizeStudents}
            >
              Синхронизировать учеников
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!termId || syncStudents.isPending || syncSeries.isPending}
              onClick={synchronizeSeries}
            >
              Синхронизировать серии
            </Button>
          </div>
          <p className="text-xs text-muted">
            Ученики сопоставляются по точному полному имени из колонки «Фамилия Имя». Серии сопоставляются по номеру; для новой серии из таблицы my239 создаст опубликованную заглушку.
          </p>
          {syncMessage ? <p className="text-sm text-success">{syncMessage}</p> : null}
          {syncError ? <p className="text-sm text-danger">{syncError}</p> : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader title="Связанные вкладки" description="Отключённые вкладки не участвуют в ручной или автоматической синхронизации." />
          {links.isPending ? <Spinner /> : links.isError ? <p className="text-sm text-danger">Не удалось загрузить связи.</p> : links.data?.length === 0 ? <p className="text-sm text-muted">Пока нет связанных вкладок.</p> : (
            <ul className="flex flex-col gap-2">
              {links.data?.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2">
                  <span className="mr-auto text-sm text-text">{link.sheet_title}</span>
                  <span className="text-xs text-muted">{link.link_kind === 'initials_legend' ? 'Расшифровка · только my239 → Sheets' : (link.group_name ?? 'группа не задана')}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={setEnabled.isPending} onClick={() => setEnabled.mutate({ linkId: link.id, enabled: !link.enabled })}>{link.enabled ? 'Отключить' : 'Включить'}</Button>
                  <ConfirmButton variant="ghost" size="sm" disabled={remove.isPending} onConfirm={() => remove.mutate(link.id)}>Удалить</ConfirmButton>
                </li>
              ))}
            </ul>
          )}
      </section>

      {visibleRuns.length > 0 ? <section className="flex flex-col gap-2 border-t border-border pt-5 first:border-t-0 first:pt-0">
          <SectionHeader title="История синхронизаций" description="Время Google относится ко всей книге, а не к отдельной ячейке." />
          {runs.isPending ? <Spinner /> : visibleRuns.slice(0, 5).map((run) => <p key={run.id} className="text-sm text-muted">{run.status === 'failed' ? 'Ошибка: ' + run.error_message : run.status} · {new Date(run.started_at).toLocaleString('ru-RU')}</p>)}
      </section> : null}
    </div>
  )
}
