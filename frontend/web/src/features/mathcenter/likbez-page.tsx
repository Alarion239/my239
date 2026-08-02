import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLink, FileText, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { Control } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  APIErrorImpl,
  likbezSchema,
  likbezDateFromISO,
  likbezWeekdayFromISO,
  russianLikbezDateToISO,
  todayLikbezDate,
  useCreateLikbez,
  useDeleteLikbez,
  useLikbez,
  useLikbezList,
  useLikbezTex,
  useMathCenterTerms,
  usePublishLikbez,
  usePutLikbezTex,
  useSetLikbezVideo,
  useUnpublishLikbez,
  useUpdateLikbez,
  useUploadLikbezPdf,
  type Likbez,
  type LikbezValues,
  type MathCenterTerm,
} from '@my239/shared'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../design/ui'
import { PdfViewer } from './pdf-viewer'
import { TexViewer } from './tex-viewer'
import { useCenterIdContext, useCenterTermContext } from './center-id-context'
import { useSeriesContext } from './use-series-context'
import { SolutionWorkbench } from './solution-editor'
import { useAutosave } from './use-autosave'

export function LikbezPage() {
  const centerId = useCenterIdContext()
  const { termId } = useCenterTermContext()
  const ctx = useSeriesContext(centerId)
  const { likbezId } = useParams<{ likbezId?: string }>()
  const { search } = useLocation()
  const requestedTermID = Number(new URLSearchParams(search).get('term_id'))
  const selectedTermID = requestedTermID > 0 && requestedTermID === termId ? requestedTermID : null

  if (!Number.isFinite(centerId) || centerId <= 0 || (!ctx.isLoading && !ctx.hasAccess)) {
    return <NoAccess />
  }
  if (ctx.isLoading) return <CenteredSpinner />
  if (likbezId) return <LikbezDetail likbezId={Number(likbezId)} isTeacher={!ctx.isStudentView} />
  return <LikbezCatalog centerId={centerId} isTeacher={!ctx.isStudentView} selectedTermID={selectedTermID} />
}

function LikbezCatalog({ centerId, isTeacher, selectedTermID }: { centerId: number; isTeacher: boolean; selectedTermID: number | null }) {
  const { data, isPending, isError } = useLikbezList(centerId)
  const { data: terms = [] } = useMathCenterTerms(centerId, isTeacher)
  const visible = selectedTermID === null ? data : data?.filter((item) => item.term_id === selectedTermID)

  if (isPending) return <CenteredSpinner />
  if (isError || !data) return <p className="py-10 text-sm text-danger">Не удалось загрузить ликбезы.</p>

  return (
    <div className="animate-rise flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="mt-1 font-display text-2xl font-medium text-ink">Ликбезы</h1>
        </div>
        {isTeacher ? <LikbezFormDialog centerId={centerId} terms={terms} /> : null}
      </header>

      {visible?.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-muted">{selectedTermID === null ? 'Ликбезов пока нет.' : 'В этом периоде ликбезов пока нет.'}</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visible?.map((item) => <LikbezCard key={item.id} likbez={item} isTeacher={isTeacher} />)}
        </div>
      )}
    </div>
  )
}

function LikbezCard({ likbez, isTeacher }: { likbez: Likbez; isTeacher: boolean }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const unpublish = useUnpublishLikbez(likbez.id)
  const navigate = useNavigate()
  const detailPath = '/mathcenter/' + year + '/likbez/' + likbez.id + search
  const [editError, setEditError] = useState<string | null>(null)

  async function openDraft() {
    setEditError(null)
    if (!likbez.published) {
      navigate(detailPath)
      return
    }
    try {
      await unpublish.mutateAsync()
      navigate(detailPath)
    } catch (error: unknown) {
      setEditError(error instanceof APIErrorImpl ? error.message : 'Не удалось открыть черновик.')
    }
  }

  return (
    <Card
      className="group flex cursor-pointer flex-col gap-4 p-4 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex-row sm:items-start"
      role="link"
      tabIndex={0}
      onClick={() => navigate(detailPath)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(detailPath)
        }
      }}
    >
      <div className="flex h-11 min-w-11 items-center justify-center rounded-lg bg-accent-soft px-2 font-display text-lg font-medium text-accent-ink" aria-label={'Ликбез №' + likbez.number}>
        {likbez.number}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="font-display text-lg font-medium text-ink group-hover:text-accent">{likbez.title}</h2>
          {!likbez.published ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">Черновик</span> : null}
        </div>
        <p className="mt-1 text-sm text-muted">Ликбез №{likbez.number} · {likbezDateFromISO(likbez.held_on)} · {likbez.term_display_name}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">{likbez.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          {likbez.has_tex ? <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />TeX</span> : null}
          {likbez.has_pdf ? <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />PDF</span> : null}
          {likbez.video_url ? <span className="inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" />Видео</span> : null}
        </div>
      </div>
      {isTeacher ? (
        <div className="flex flex-col items-stretch gap-2 sm:w-44 sm:items-end" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <Button size="sm" variant="secondary" disabled={unpublish.isPending} onClick={() => { void openDraft() }}>
            <Pencil className="h-4 w-4" />{unpublish.isPending ? 'Открываем…' : 'Редактировать'}
          </Button>
          {editError ? <p className="text-right text-xs text-danger" role="alert">{editError}</p> : null}
        </div>
      ) : null}
    </Card>
  )
}

function LikbezDetail({ likbezId, isTeacher }: { likbezId: number; isTeacher: boolean }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const { data, isPending, isError } = useLikbez(likbezId)
  const terms = useMathCenterTerms(data?.math_center_id ?? 0, isTeacher && !data?.published)
  const tex = useLikbezTex(likbezId, !!data?.has_tex && !(isTeacher && !data?.published))

  if (isPending) return <CenteredSpinner />
  if (isError || !data) return <NoAccess />
  if (isTeacher && !data.published) {
    if (terms.isPending) return <CenteredSpinner />
    return <LikbezDraftEditor likbez={data} terms={terms.data ?? []} />
  }
  return (
    <div className="animate-rise flex flex-col gap-5">
      <Link to={'/mathcenter/' + year + '/likbez' + search} className="self-start text-sm font-medium text-accent hover:underline">← Все ликбезы</Link>
      <header className="border-b border-line pb-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Ликбез №{data.number} · {data.term_display_name}</p>
        <h1 className="mt-2 font-display text-3xl font-medium text-ink">{data.title}</h1>
        <p className="mt-2 text-sm text-muted">{likbezDateFromISO(data.held_on)}</p>
        <p className="mt-4 max-w-3xl whitespace-pre-wrap leading-7 text-ink">{data.description}</p>
      </header>
      <LikbezMaterials likbez={data} tex={tex} />
    </div>
  )
}

function LikbezDraftEditor({ likbez, terms }: { likbez: Likbez; terms: MathCenterTerm[] }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const navigate = useNavigate()
  const update = useUpdateLikbez(likbez.id)
  const publish = usePublishLikbez(likbez.id)
  const remove = useDeleteLikbez(likbez.math_center_id)
  const texQuery = useLikbezTex(likbez.id, true)
  const putTex = usePutLikbezTex(likbez.id)
  const uploadPdf = useUploadLikbezPdf(likbez.id)
  const setVideo = useSetLikbezVideo(likbez.id)
  const initialDetails = useMemo<LikbezValues>(() => ({
    term_id: likbez.term_id,
    number: likbez.number,
    title: likbez.title,
    held_on: likbezDateFromISO(likbez.held_on),
    description: likbez.description,
  }), [likbez.description, likbez.held_on, likbez.number, likbez.term_id, likbez.title])
  const { register, control, reset, setError, trigger, getValues, formState: { errors } } = useForm<LikbezValues>({
    resolver: zodResolver(likbezSchema),
    defaultValues: initialDetails,
  })
  const watchedDetails = useWatchValues(control)
  const { term_id: watchedTermID, number: watchedNumber, title: watchedTitle, held_on: watchedHeldOn, description: watchedDescription } = watchedDetails
  const detailsAutosave = useAutosave({
    initialValue: initialDetails,
    save: async (values: LikbezValues) => {
      const heldOn = russianLikbezDateToISO(values.held_on)
      if (!heldOn) throw new Error('Укажите дату проведения.')
      await update.mutateAsync({ ...values, held_on: heldOn })
    },
    equals: sameLikbezValues,
    isValid: (values) => likbezSchema.safeParse(values).success,
    invalidMessage: 'Проверьте сведения о ликбезе.',
    formatError: (value) => value instanceof APIErrorImpl ? value.message : value instanceof Error ? value.message : 'Не удалось сохранить ликбез.',
  })
  const { schedule: scheduleDetails, setBaseline: setDetailsBaseline } = detailsAutosave

  useEffect(() => {
    reset(initialDetails)
    setDetailsBaseline(initialDetails)
  }, [initialDetails, reset, setDetailsBaseline])

  useEffect(() => {
    scheduleDetails({ term_id: watchedTermID, number: watchedNumber, title: watchedTitle, held_on: watchedHeldOn, description: watchedDescription })
  }, [scheduleDetails, watchedDescription, watchedHeldOn, watchedNumber, watchedTermID, watchedTitle])

  async function flushDetails() {
    try {
      if (!(await trigger())) {
        setError('held_on', { message: 'Проверьте дату проведения.' })
        throw new Error('Проверьте сведения о ликбезе.')
      }
      scheduleDetails(getValues())
      if (!(await detailsAutosave.flush())) {
        throw new Error('Не удалось опубликовать ликбез: ' + (detailsAutosave.error ?? 'не удалось сохранить сведения.'))
      }
    } catch (value) {
      const message = value instanceof Error ? value.message : 'Не удалось опубликовать ликбез.'
      throw new Error(message)
    }
  }

  function deleteDraft() {
    if (!window.confirm('Удалить ликбез «' + likbez.title + '»?')) return
    remove.mutate(likbez.id, { onSuccess: () => navigate('/mathcenter/' + year + '/likbez' + search) })
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Link to={'/mathcenter/' + year + '/likbez' + search} className="self-start text-sm font-medium text-accent hover:underline">← Все ликбезы</Link>
      <form className="flex flex-col gap-4 border-b border-line pb-6" noValidate onSubmit={(event) => event.preventDefault()}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Черновик · ликбез №{likbez.number}</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(11rem,1fr)_7rem_minmax(14rem,2fr)_11rem]">
          <Field label="Период" error={errors.term_id?.message}>{({ id, invalid }) => <Select id={id} invalid={invalid} {...register('term_id', { valueAsNumber: true })}>{terms.map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}</Select>}</Field>
          <Field label="Номер" error={errors.number?.message}>{({ id, invalid }) => <Input id={id} type="number" min={1} invalid={invalid} {...register('number', { valueAsNumber: true })} />}</Field>
          <Field label="Название" error={errors.title?.message}>{({ id, invalid }) => <Input id={id} invalid={invalid} {...register('title')} />}</Field>
          <LikbezDateField control={control} error={errors.held_on?.message} />
        </div>
        <Field label="Краткое описание" error={errors.description?.message}>{({ id, invalid }) => <Textarea id={id} invalid={invalid} {...register('description')} />}</Field>
        {detailsAutosave.error ? <p className="text-sm text-danger" role="status">{detailsAutosave.error}</p> : detailsAutosave.status === 'saving' ? <p className="text-sm text-muted" role="status">Сохраняем сведения…</p> : detailsAutosave.status === 'saved' ? <p className="text-sm text-status-accepted" role="status">Сведения сохранены</p> : null}
      </form>

      <SolutionWorkbench
        title={'Ликбез №' + likbez.number}
        mode="edit"
        hasTex={likbez.has_tex}
        hasPdf={likbez.has_pdf}
        link={likbez.video_url}
        centerId={likbez.math_center_id}
        pdfPath={'/mathcenter/likbez/' + likbez.id + '/pdf'}
        pdfTitle={likbez.title + ' (PDF)'}
        initialTex={texQuery.data?.tex}
        texQuery={texQuery}
        formatTabLabel="Формат ликбеза"
        confirmPublication={false}
        onPutTex={(tex) => putTex.mutateAsync(tex)}
        onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
        onSetLink={(link) => setVideo.mutateAsync(link)}
        onBeforePublish={flushDetails}
        onPublish={() => publish.mutateAsync()}
        onClose={() => navigate('/mathcenter/' + year + '/likbez' + search)}
      />

      <section className="flex flex-wrap items-center justify-between gap-3 border-t border-danger/20 pt-5" aria-label="Опасная зона">
        <div>
          <h2 className="font-medium text-ink">Удалить ликбез</h2>
          <p className="mt-1 text-sm text-muted">Черновик и все его материалы будут удалены без возможности восстановления.</p>
        </div>
        <Button type="button" variant="ghost" className="text-danger hover:bg-danger-soft" disabled={detailsAutosave.status === 'saving' || uploadPdf.isPending || remove.isPending} onClick={deleteDraft}>
          <Trash2 className="h-4 w-4" />{remove.isPending ? 'Удаляем…' : 'Удалить ликбез'}
        </Button>
      </section>
    </div>
  )
}

function useWatchValues(control: Control<LikbezValues>): LikbezValues {
  // Kept as a tiny wrapper so the editor's autosave subscription remains
  // explicit and the form fields stay strongly typed.
  return useWatch({ control }) as LikbezValues
}

function sameLikbezValues(left: LikbezValues, right: LikbezValues) {
  return left.term_id === right.term_id && left.number === right.number && left.title === right.title && left.held_on === right.held_on && left.description === right.description
}

function LikbezDateField({ control, error }: { control: Control<LikbezValues>; error?: string }) {
  return (
    <Field label="Дата" error={error}>
      {({ id, invalid }) => (
        <Controller
          control={control}
          name="held_on"
          render={({ field }) => {
            const iso = russianLikbezDateToISO(field.value) ?? ''
            const weekday = likbezWeekdayFromISO(iso)
            const capitalizedWeekday = weekday ? weekday.charAt(0).toLocaleUpperCase('ru-RU') + weekday.slice(1) : null
            return (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={id}
                  ref={field.ref}
                  name={field.name}
                  type="date"
                  value={iso}
                  invalid={invalid}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(likbezDateFromISO(event.target.value))}
                />
                {capitalizedWeekday ? <span className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink">{capitalizedWeekday}</span> : null}
              </div>
            )
          }}
        />
      )}
    </Field>
  )
}

function LikbezMaterials({ likbez, tex }: { likbez: Likbez; tex: ReturnType<typeof useLikbezTex> }) {
  const hasMaterials = likbez.has_tex || likbez.has_pdf || !!likbez.video_url
  if (!hasMaterials) return <Card className="px-6 py-12 text-center"><p className="text-muted">Материалы ещё не добавлены.</p></Card>
  return (
    <div className="flex flex-col gap-6">
      {likbez.has_tex ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">Конспект</h2>{tex.isPending ? <CenteredSpinner /> : tex.data ? <TexViewer tex={tex.data.tex} /> : <p className="text-danger">Не удалось загрузить TeX.</p>}</section> : null}
      {likbez.has_pdf ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">PDF</h2><PdfViewer path={'/mathcenter/likbez/' + likbez.id + '/pdf'} title={likbez.title + ' (PDF)'} /></section> : null}
      {likbez.video_url ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">Видео</h2><VideoAttachment url={likbez.video_url} title={likbez.title + ' (видео)'} /></section> : null}
    </div>
  )
}

function VideoAttachment({ url, title }: { url: string; title: string }) {
  const embed = youtubeEmbed(url)
  return (
    <div className="flex flex-col gap-2">
      <iframe
        src={embed ?? url}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full rounded-lg border border-line bg-surface"
      />
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent hover:underline">
        <ExternalLink className="h-4 w-4" />Открыть видео в новой вкладке
      </a>
    </div>
  )
}

function youtubeEmbed(url: string): string | null {
  const match =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/embed\/([\w-]{11})/)
  return match ? 'https://www.youtube.com/embed/' + match[1] : null
}

function LikbezFormDialog({ centerId, terms, trigger }: { centerId: number; terms: MathCenterTerm[]; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const create = useCreateLikbez(centerId)
  const { register, control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<LikbezValues>({ resolver: zodResolver(likbezSchema) })

  useEffect(() => {
    if (open) reset({ term_id: terms.find((term) => term.is_active)?.id ?? 0, number: 1, title: '', held_on: todayLikbezDate(), description: '' })
  }, [open, reset, terms])

  const submit = handleSubmit((values) => new Promise<void>((resolve) => {
    const heldOn = russianLikbezDateToISO(values.held_on)
    if (!heldOn) {
      setError('held_on', { message: 'Укажите дату в формате ДД-ММ-ГГГГ' })
      resolve()
      return
    }
    const body = { ...values, held_on: heldOn }
    const callbacks = {
      onSuccess: () => { setOpen(false); resolve() },
      onError: (error: unknown) => {
        if (error instanceof APIErrorImpl) setError('title', { message: error.message })
        else setError('title', { message: 'Не удалось сохранить ликбез.' })
        resolve()
      },
    }
    create.mutate({ term_id: body.term_id, title: body.title, held_on: body.held_on, description: body.description }, callbacks)
  }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus className="h-4 w-4" />Новый ликбез</Button>}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogTitle>Новый ликбез</DialogTitle>
        <DialogDescription>Номер будет присвоен автоматически.</DialogDescription>
        <form className="mt-4 flex flex-col gap-4" noValidate onSubmit={submit}>
          <Field label="Период" error={errors.term_id?.message}>{({ id, invalid }) => <Select id={id} invalid={invalid} {...register('term_id', { valueAsNumber: true })}><option value={0}>Выберите период</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}</Select>}</Field>
          <Field label="Название" error={errors.title?.message}>{({ id, invalid }) => <Input id={id} invalid={invalid} {...register('title')} />}</Field>
          <LikbezDateField control={control} error={errors.held_on?.message} />
          <Field label="Краткое описание" error={errors.description?.message}>{({ id, invalid }) => <Textarea id={id} invalid={invalid} {...register('description')} />}</Field>
          <Button type="submit" disabled={isSubmitting || create.isPending}>{isSubmitting || create.isPending ? 'Сохраняем…' : 'Сохранить'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CenteredSpinner() { return <div className="flex justify-center py-16"><Spinner /></div> }
function NoAccess() { return <Card className="animate-rise px-6 py-16 text-center"><p className="text-muted">Нет доступа к этому ликбезу.</p></Card> }
