import { useState } from 'react'
import { APIErrorImpl, useSeedDemo, type SeedResult } from '@my239/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../design/ui'

// SeedDemoCard triggers the admin "reset + reseed demo data" action. Each run
// wipes the previous demo dataset (the sentinel cohort, year 2099) and rebuilds
// a fictional center with groups, teachers, students, published series and
// submissions across every status — so the app can be exercised end-to-end.
export function SeedDemoCard() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<SeedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seed = useSeedDemo()

  function run() {
    setError(null)
    seed.mutate(undefined, {
      onSuccess: (res) => setResult(res),
      onError: (e) =>
        setError(e instanceof APIErrorImpl ? e.message : 'Не удалось создать демо-данные.'),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Создаёт тестовый матцентр (выпуск 2099) с группами, преподавателями,
        учениками, опубликованными сериями и сдачами во всех статусах. Каждый
        запуск сначала удаляет предыдущие демо-данные, затем создаёт их заново.
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setResult(null)
            setError(null)
          }
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary" className="self-start">
            Заполнить демо-данными
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          {result ? (
            <SeedResultView result={result} onClose={() => setOpen(false)} />
          ) : (
            <>
              <DialogTitle>Создать демо-данные?</DialogTitle>
              <DialogDescription>
                Все предыдущие демо-данные (матцентр «Выпуск 2099» и пользователи
                с логином <code>demo-…</code>) будут удалены и созданы заново.
                Реальные данные не затрагиваются.
              </DialogDescription>
              {error ? (
                <p className="mt-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={seed.isPending}
                >
                  Отмена
                </Button>
                <Button type="button" onClick={run} disabled={seed.isPending}>
                  {seed.isPending ? 'Создание…' : 'Создать'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SeedResultView({ result, onClose }: { result: SeedResult; onClose: () => void }) {
  const counts: { label: string; value: number }[] = [
    { label: 'Группы', value: result.groups },
    { label: 'Преподаватели', value: result.teachers },
    { label: 'Ученики', value: result.students },
    { label: 'Серии', value: result.series },
    { label: 'Задачи', value: result.problems },
    { label: 'Подзадачи', value: result.subproblems },
    { label: 'Гробы', value: result.coffins },
    { label: 'Сдачи', value: result.submissions },
  ]
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Демо-данные созданы</DialogTitle>
      <DialogDescription>
        Матцентр «Выпуск {result.graduation_year}». Войдите под любым из логинов
        ниже с паролем <code className="font-semibold">{result.password}</code>.
      </DialogDescription>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {counts.map((c) => (
          <span key={c.label}>
            {c.label}: <span className="font-medium text-ink">{c.value}</span>
          </span>
        ))}
      </div>

      <p className="text-xs text-muted">
        Показаны преподаватели и первые ученики. Всего учеников:{' '}
        <span className="font-medium text-ink">{result.student_count}</span> —
        логины <code>demo-student-1</code> … <code>demo-student-{result.student_count}</code>,
        пароль тот же.
      </p>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Логин</th>
              <th className="px-3 py-2 font-medium">Роль</th>
              <th className="px-3 py-2 font-medium">Имя</th>
            </tr>
          </thead>
          <tbody>
            {result.logins.map((l) => (
              <tr key={l.username} className="border-t border-line">
                <td className="px-3 py-1.5 font-mono text-xs text-ink">{l.username}</td>
                <td className="px-3 py-1.5 text-muted">{l.role}</td>
                <td className="px-3 py-1.5 text-ink">{l.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          Готово
        </Button>
      </div>
    </div>
  )
}
