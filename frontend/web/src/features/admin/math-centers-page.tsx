import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  formatDate,
  useDeleteMathCenter,
  useMathCenters,
} from '@my239/shared'
import {
  Card,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '../../design/ui'
import { ConfirmButton, SectionHeader } from './_shared'
import { CenterGroups } from './center-groups'
import { CreateMathCenterDialog } from './create-math-center-dialog'

function CentersTable() {
  const { data: centers, isPending, isError } = useMathCenters()
  const deleteCenter = useDeleteMathCenter()
  const [expanded, setExpanded] = useState<number | null>(null)

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !centers) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить матцентры.</p>
  }
  if (centers.length === 0) {
    return <p className="py-6 text-sm text-muted">Пока нет матцентров.</p>
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th className="w-8" />
          <Th>Год выпуска</Th>
          <Th>Создан</Th>
          <Th className="text-right">Действия</Th>
        </Tr>
      </THead>
      <TBody>
        {centers.map((c) => {
          const isOpen = expanded === c.id
          return (
            <Fragment key={c.id}>
              <Tr className={isOpen ? 'border-0' : undefined}>
                <Td>
                  <button
                    type="button"
                    aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
                    aria-expanded={isOpen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-ink"
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </Td>
                <Td className="font-medium text-ink">{c.graduation_year}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(c.created_at)}</Td>
                <Td className="text-right">
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    disabled={deleteCenter.isPending}
                    onConfirm={() => deleteCenter.mutate(c.id)}
                  >
                    Удалить
                  </ConfirmButton>
                </Td>
              </Tr>
              {isOpen ? (
                <Tr>
                  <Td colSpan={4} className="bg-surface-muted/40">
                    <CenterGroups centerId={c.id} />
                  </Td>
                </Tr>
              ) : null}
            </Fragment>
          )
        })}
      </TBody>
    </Table>
  )
}

export function MathCentersPage() {
  return (
    <div className="animate-rise flex flex-col gap-8">
      <section>
        <SectionHeader
          title="Матцентры"
          description="Когорты по году выпуска и их группы."
          action={<CreateMathCenterDialog />}
        />
        <Card className="p-2">
          <CentersTable />
        </Card>
      </section>
    </div>
  )
}
