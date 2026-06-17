import { describe, expect, it } from 'vitest'
import { deriveCapabilities } from './capabilities'
import type { MeResponse } from '../types'

describe('deriveCapabilities', () => {
  it('returns the signed-out defaults for null inputs', () => {
    const caps = deriveCapabilities(null, null)
    expect(caps).toEqual({
      isAdmin: false,
      canImpersonate: false,
      teacherCenters: [],
      studentCenter: null,
      isTeacher: false,
      isStudent: false,
    })
  })

  it('ties canImpersonate to isAdmin', () => {
    const caps = deriveCapabilities({ is_admin: true }, undefined)
    expect(caps.isAdmin).toBe(true)
    expect(caps.canImpersonate).toBe(true)
  })

  it('derives teacher centers and isTeacher', () => {
    const me: MeResponse = {
      teacher: {
        centers: [
          {
            id: 5,
            graduation_year: 2027,
            grade: 9,
            is_head_teacher: true,
            teachers: [],
            groups: [],
          },
        ],
      },
    }
    const caps = deriveCapabilities({ is_admin: false }, me)
    expect(caps.isTeacher).toBe(true)
    expect(caps.teacherCenters).toHaveLength(1)
    expect(caps.studentCenter).toBeNull()
    expect(caps.isStudent).toBe(false)
  })

  it('derives the student center and isStudent', () => {
    const me: MeResponse = {
      student: {
        center: { id: 3, graduation_year: 2026, grade: 10 },
        group: { id: 1, name: 'A' },
        head_teachers: [],
      },
    }
    const caps = deriveCapabilities({ is_admin: false }, me)
    expect(caps.isStudent).toBe(true)
    expect(caps.studentCenter).toEqual({ id: 3, graduation_year: 2026, grade: 10 })
    expect(caps.isTeacher).toBe(false)
  })
})
