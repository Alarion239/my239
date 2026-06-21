import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  createGroupSchema,
  useManageGroups,
  useManageCreateGroup,
  useManageDeleteGroup,
  type CreateGroupValues,
} from '@my239/shared'
import { Button, Card, CardContent, Input, Spinner } from '../../../design/ui'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'

// GroupsTab lists a center's groups and lets a head teacher add or remove them.
export function GroupsTab({ centerId }: { centerId: number }) {
  const { data: groups, isPending, isError } = useManageGroups(centerId)
  const createGroup = useManageCreateGroup(centerId)
  const deleteGroup = useManageDeleteGroup(centerId)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateGroupValues>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '' },
  })

  const onSubmit = handleSubmit(
    (values) =>
      new Promise<void>((resolve) => {
        createGroup.mutate(values, {
          onSuccess: () => {
            reset()
            resolve()
          },
          onError: () => {
            setError('name', { message: 'Не удалось создать группу' })
            resolve()
          },
        })
      }),
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader title="Группы" description="Группы учеников этого матцентра." />

        {isPending ? (
          <Spinner />
        ) : isError || !groups ? (
          <p className="text-sm text-danger">Не удалось загрузить группы.</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted">Пока нет групп.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
              >
                <span className="text-sm text-ink">{g.name}</span>
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  disabled={deleteGroup.isPending}
                  onConfirm={() => deleteGroup.mutate(g.id)}
                >
                  Удалить
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
          <div className="flex-1">
            <Input
              placeholder="Название группы"
              invalid={!!errors.name}
              aria-label="Название группы"
              {...register('name')}
            />
            {errors.name ? (
              <p className="mt-1 text-sm text-danger">{errors.name.message}</p>
            ) : null}
          </div>
          <Button type="submit" variant="secondary" disabled={isSubmitting}>
            Добавить
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
