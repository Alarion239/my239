import { useEffect, useRef, useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLink, FileText, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  APIErrorImpl,
  likbezSchema,
  likbezDateFromISO,
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
import { useCenterIdContext } from './center-id-context'
import { useSeriesContext } from './use-series-context'

export function LikbezPage() {
  const centerId = useCenterIdContext()
  const ctx = useSeriesContext(centerId)
  const { likbezId } = useParams<{ likbezId?: string }>()

  if (!Number.isFinite(centerId) || centerId <= 0 || (!ctx.isLoading && !ctx.hasAccess)) {
    return <NoAccess />
  }
  if (ctx.isLoading) return <CenteredSpinner />
  if (likbezId) return <LikbezDetail likbezId={Number(likbezId)} isTeacher={!ctx.isStudentView} />
  return <LikbezCatalog centerId={centerId} isTeacher={!ctx.isStudentView} />
}

function LikbezCatalog({ centerId, isTeacher }: { centerId: number; isTeacher: boolean }) {
  const { data, isPending, isError } = useLikbezList(centerId)
  const { data: terms = [] } = useMathCenterTerms(centerId, isTeacher)

  if (isPending) return <CenteredSpinner />
  if (isError || !data) return <p className="py-10 text-sm text-danger">Не удалось загрузить ликбезы.</p>

  return (
    <div className="animate-rise flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Сквозной курс</p>
          <h1 className="mt-1 font-display text-2xl font-medium text-ink">Ликбезы</h1>
          <p className="mt-1 text-sm text-muted">Лекции матцентра — отдельно от серий задач.</p>
        </div>
        {isTeacher ? <LikbezFormDialog centerId={centerId} terms={terms} /> : null}
      </header>

      {data.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-muted">Ликбезов пока нет.</p>
          {isTeacher ? <p className="mt-2 text-sm text-muted">Создайте первую лекцию, чтобы собрать материалы в одном месте.</p> : null}
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.map((item) => <LikbezCard key={item.id} likbez={item} centerId={centerId} isTeacher={isTeacher} terms={terms} />)}
        </div>
      )}
    </div>
  )
}

function LikbezCard({ likbez, centerId, isTeacher, terms }: { likbez: Likbez; centerId: number; isTeacher: boolean; terms: MathCenterTerm[] }) {
  const { year } = useParams<{ year: string }>()
  const publish = usePublishLikbez(likbez.id)
  const unpublish = useUnpublishLikbez(likbez.id)
  const remove = useDeleteLikbez(centerId)
  const navigate = useNavigate()
  const hasMaterials = likbez.has_pdf || likbez.has_tex || !!likbez.video_url

  return (
    <Card className="group flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
      <div className="flex h-11 min-w-11 items-center justify-center rounded-lg bg-accent-soft px-2 font-display text-lg font-medium text-accent-ink" aria-label={'Ликбез №' + likbez.number}>
        {likbez.number}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={'/mathcenter/' + year + '/likbez/' + likbez.id} className="font-display text-lg font-medium text-ink hover:text-accent">
            {likbez.title}
          </Link>
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
        <div className="flex flex-wrap gap-2 sm:w-44 sm:justify-end">
          <LikbezFormDialog centerId={centerId} terms={terms} likbez={likbez} trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" />Изменить</Button>} />
          <Button size="sm" variant="secondary" disabled={(likbez.published ? unpublish : publish).isPending || (!likbez.published && !hasMaterials)} onClick={() => (likbez.published ? unpublish : publish).mutate()}>
            {likbez.published ? 'Снять' : 'Опубликовать'}
          </Button>
          <Button size="sm" variant="ghost" aria-label={'Удалить ' + likbez.title} disabled={remove.isPending} onClick={() => {
            if (window.confirm('Удалить ликбез «' + likbez.title + '»?')) remove.mutate(likbez.id, { onSuccess: () => navigate('/mathcenter/' + year + '/likbez') })
          }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null}
    </Card>
  )
}

function LikbezDetail({ likbezId, isTeacher }: { likbezId: number; isTeacher: boolean }) {
  const { year } = useParams<{ year: string }>()
  const { data, isPending, isError } = useLikbez(likbezId)
  const tex = useLikbezTex(likbezId, !!data?.has_tex)

  if (isPending) return <CenteredSpinner />
  if (isError || !data) return <NoAccess />
  return (
    <div className="animate-rise flex flex-col gap-5">
      <Link to={'/mathcenter/' + year + '/likbez'} className="self-start text-sm font-medium text-accent hover:underline">← Все ликбезы</Link>
      <header className="border-b border-line pb-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Ликбез №{data.number} · {data.term_display_name}</p>
        <h1 className="mt-2 font-display text-3xl font-medium text-ink">{data.title}</h1>
        <p className="mt-2 text-sm text-muted">{likbezDateFromISO(data.held_on)}</p>
        <p className="mt-4 max-w-3xl whitespace-pre-wrap leading-7 text-ink">{data.description}</p>
      </header>
      {isTeacher ? <LikbezMaterialsDialog likbez={data} /> : null}
      <LikbezMaterials likbez={data} tex={tex} />
    </div>
  )
}

function LikbezMaterials({ likbez, tex }: { likbez: Likbez; tex: ReturnType<typeof useLikbezTex> }) {
  const hasMaterials = likbez.has_tex || likbez.has_pdf || !!likbez.video_url
  if (!hasMaterials) return <Card className="px-6 py-12 text-center"><p className="text-muted">Материалы ещё не добавлены.</p></Card>
  return (
    <div className="flex flex-col gap-6">
      {likbez.has_tex ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">Конспект</h2>{tex.isPending ? <CenteredSpinner /> : tex.data ? <TexViewer tex={tex.data.tex} /> : <p className="text-danger">Не удалось загрузить TeX.</p>}</section> : null}
      {likbez.has_pdf ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">PDF</h2><PdfViewer path={'/mathcenter/likbez/' + likbez.id + '/pdf'} title={likbez.title + ' (PDF)'} /></section> : null}
      {likbez.video_url ? <section><h2 className="mb-3 font-display text-xl font-medium text-ink">Видео</h2><a href={likbez.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted"><ExternalLink className="h-4 w-4" />Открыть видео</a></section> : null}
    </div>
  )
}

function LikbezFormDialog({ centerId, terms, likbez, trigger }: { centerId: number; terms: MathCenterTerm[]; likbez?: Likbez; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const create = useCreateLikbez(centerId)
  const update = useUpdateLikbez(likbez?.id ?? 0)
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<LikbezValues>({ resolver: zodResolver(likbezSchema) })

  useEffect(() => {
    if (open) reset({ term_id: likbez?.term_id ?? terms.find((term) => term.is_active)?.id ?? 0, number: likbez?.number ?? 1, title: likbez?.title ?? '', held_on: likbez ? likbezDateFromISO(likbez.held_on) : todayLikbezDate(), description: likbez?.description ?? '' })
  }, [likbez, open, reset, terms])

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
    if (likbez) {
      update.mutate(body, callbacks)
      return
    }
    create.mutate({ term_id: body.term_id, title: body.title, held_on: body.held_on, description: body.description }, callbacks)
  }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus className="h-4 w-4" />Новый ликбез</Button>}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogTitle>{likbez ? 'Изменить ликбез' : 'Новый ликбез'}</DialogTitle>
        <DialogDescription>{likbez ? 'Измените сведения и сквозной номер лекции.' : 'Номер будет присвоен автоматически.'}</DialogDescription>
        <form className="mt-4 flex flex-col gap-4" noValidate onSubmit={submit}>
          <Field label="Период" error={errors.term_id?.message}>{({ id, invalid }) => <Select id={id} invalid={invalid} {...register('term_id', { valueAsNumber: true })}><option value={0}>Выберите период</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.display_name}</option>)}</Select>}</Field>
          {likbez ? <Field label="Номер ликбеза" error={errors.number?.message}>{({ id, invalid }) => <Input id={id} type="number" min={1} invalid={invalid} {...register('number', { valueAsNumber: true })} />}</Field> : null}
          <Field label="Название" error={errors.title?.message}>{({ id, invalid }) => <Input id={id} invalid={invalid} {...register('title')} />}</Field>
          <Field label="Дата" error={errors.held_on?.message}>{({ id, invalid }) => <Input id={id} inputMode="numeric" placeholder="ДД-ММ-ГГГГ" invalid={invalid} {...register('held_on')} />}</Field>
          <Field label="Краткое описание" error={errors.description?.message}>{({ id, invalid }) => <Textarea id={id} invalid={invalid} {...register('description')} />}</Field>
          <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>{isSubmitting || create.isPending || update.isPending ? 'Сохраняем…' : 'Сохранить'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LikbezMaterialsDialog({ likbez }: { likbez: Likbez }) {
  const [open, setOpen] = useState(false)
  const [tex, setTex] = useState('')
  const [link, setLink] = useState(likbez.video_url ?? '')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const texQuery = useLikbezTex(likbez.id, open && likbez.has_tex)
  const putTex = usePutLikbezTex(likbez.id)
  const uploadPdf = useUploadLikbezPdf(likbez.id)
  const setVideo = useSetLikbezVideo(likbez.id)

  useEffect(() => {
    if (!open) return
    setTex(texQuery.data?.tex ?? '')
    setLink(likbez.video_url ?? '')
    setError(null)
  }, [likbez.video_url, open, texQuery.data?.tex])

  const run = (work: () => Promise<unknown>) => void work().catch((value: unknown) => setError(value instanceof APIErrorImpl ? value.message : 'Не удалось сохранить материал.'))
  const busy = putTex.isPending || uploadPdf.isPending || setVideo.isPending
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary"><Pencil className="h-4 w-4" />Материалы</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle>Материалы ликбеза</DialogTitle>
        <DialogDescription>Можно прикрепить несколько форматов; публикация остаётся отдельным действием.</DialogDescription>
        {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-col gap-4">
          <section className="flex flex-col gap-2"><label className="text-sm font-medium text-ink">LaTeX</label><Textarea value={tex} onChange={(event) => setTex(event.target.value)} className="min-h-32 font-mono text-xs" placeholder={'\\documentclass{article}\n\\begin{document}…'} /><Button size="sm" variant="secondary" className="self-start" disabled={busy || tex.trim() === ''} onClick={() => run(async () => { await putTex.mutateAsync(tex) })}>{putTex.isPending ? 'Сохраняем…' : 'Сохранить LaTeX'}</Button></section>
          <section className="flex flex-col gap-2 border-t border-line pt-4"><span className="text-sm font-medium text-ink">PDF{likbez.has_pdf ? ' · загружен' : ''}</span><input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(async () => { await uploadPdf.mutateAsync(file) }) }} /><Button size="sm" variant="secondary" className="self-start" disabled={busy} onClick={() => fileRef.current?.click()}>{uploadPdf.isPending ? 'Загружаем…' : 'Загрузить PDF'}</Button></section>
          <section className="flex flex-col gap-2 border-t border-line pt-4"><label className="text-sm font-medium text-ink">Ссылка на видео</label><Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://youtube.com/watch?v=…" /><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy || link.trim() === ''} onClick={() => run(async () => { await setVideo.mutateAsync(link.trim()) })}>{setVideo.isPending ? 'Сохраняем…' : 'Сохранить ссылку'}</Button>{likbez.video_url ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await setVideo.mutateAsync(''); setLink('') })}>Убрать</Button> : null}</div></section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CenteredSpinner() { return <div className="flex justify-center py-16"><Spinner /></div> }
function NoAccess() { return <Card className="animate-rise px-6 py-16 text-center"><p className="text-muted">Нет доступа к этому ликбезу.</p></Card> }
