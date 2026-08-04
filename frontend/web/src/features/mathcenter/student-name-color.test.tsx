import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  StudentNameColorSelector,
  StudentNameLabel,
  normalizedStudentNameColor,
  studentNameColorStyle,
} from './student-name-color'

describe('student name colors', () => {
  it('normalizes valid HEX values and rejects malformed values', () => {
    expect(normalizedStudentNameColor(' #ffd09a ')).toBe('#FFD09A')
    expect(normalizedStudentNameColor('#ffd09a')).toBe('#FFD09A')
    expect(normalizedStudentNameColor('#12AB3')).toBeNull()
    expect(normalizedStudentNameColor('#GG0000')).toBeNull()
  })

  it('chooses readable foreground colors from luminance', () => {
    expect(studentNameColorStyle('#7f1d2d')).toEqual({
      backgroundColor: '#7F1D2D',
      color: '#FFFFFF',
    })
    expect(studentNameColorStyle('#fff0a6')).toEqual({
      backgroundColor: '#FFF0A6',
      color: '#171A22',
    })
    expect(studentNameColorStyle(null)).toBeUndefined()
  })

  it('supports keyboard selection and applies the color to the name label', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <StudentNameColorSelector value={null} onChange={onChange} />
        <StudentNameLabel name="Аня Смирнова" backgroundHex="#7f1d2d" />
      </>,
    )

    const orange = screen.getByRole('radio', { name: 'Оранжевый' })
    orange.focus()
    expect(document.activeElement).toBe(orange)
    await user.click(orange)
    expect(onChange).toHaveBeenCalledWith('#FFD09A')
    expect(screen.getByText('Аня Смирнова')).toHaveAttribute(
      'data-student-name-color',
      '#7F1D2D',
    )
  })
})
