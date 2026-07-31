import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Series } from '@my239/shared'
import { StudentRazbor } from './student-razbor'

describe('StudentRazbor access', () => {
  it('shows a clear unavailable state when the student is restricted', () => {
    const series: Series = {
      id: 42,
      math_center_id: 7,
      number: 2,
      name: 'Многочлены',
      display_name: 'Серия 2',
      due_at: '2026-01-01T00:00:00Z',
      published: true,
      has_pdf: false,
      has_tex: false,
      razbor_access: false,
      razbor_video_access: false,
      razbor_pdf_tex_access: false,
      problems: [],
    }

    render(<StudentRazbor series={series} />)

    expect(screen.getByText('Доступ к разборам закрыт.')).toBeInTheDocument()
    expect(
      screen.getByText('Условия серий и сдача задач по-прежнему доступны.'),
    ).toBeInTheDocument()
  })

  it('explains when only video razbors are available', () => {
    const series: Series = {
      id: 42,
      math_center_id: 7,
      number: 2,
      name: 'Многочлены',
      display_name: 'Серия 2',
      due_at: '2026-01-01T00:00:00Z',
      published: true,
      has_pdf: false,
      has_tex: false,
      razbor_access: true,
      razbor_video_access: true,
      razbor_pdf_tex_access: false,
      problems: [],
    }

    render(<StudentRazbor series={series} />)

    expect(
      screen.getByText('Доступны только видеоразборы этой серии.'),
    ).toBeInTheDocument()
  })
})
