// TeacherGrid renders the all-series spreadsheet for one math center:
// students × groups along the row axis, every series side-by-side along
// the column axis (each series has its own short subproblem headers like
// "Упр / 1 / 2a / 2b"). The current series gets a prominent border, the
// container scrolls horizontally so it lands centered on mount, and any
// cell the current user is actively grading gets a primary-blue frame.
//
// We use a plain HTML table inside a scrollable wrapper. RN-web's
// ScrollView doesn't support sticky positioning or scrollIntoView, and
// tables give us per-cell layout alignment across all the series blocks
// for free.

import {useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef} from 'react'
import {Text, View} from 'react-native'
import {useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../../api'
import {
    CenterGridCell,
    CenterGridResponse,
    centerGridCellKey,
    getCenterGrid,
    statusBackgroundColor,
    statusBorderColor,
    statusLabel,
    type ThreadStatus,
} from '../../api/homework'
import {useAuth} from '../../auth'
import {Card, colors, ErrorBanner, Subheading} from '../ui'

// TeacherGridHandle gives the parent a way to ask the grid to refresh
// (after a series was just created/edited/deleted, the matrix needs to
// be re-pulled).
export interface TeacherGridHandle {
    reload(): Promise<void>
}

// claim_holder_user_id may be stale: if the lease has expired we treat
// the cell as "free". Pure helper so callers don't repeat the math.
function liveClaimHolder(cell: CenterGridCell | undefined): number | null {
    if (!cell || !cell.claim_holder_user_id) return null
    if (cell.claim_expires_at && new Date(cell.claim_expires_at).getTime() <= Date.now()) return null
    return cell.claim_holder_user_id
}

// shortStatus is the inside-cell glyph. The colored background + border
// is the main signal; this is the secondary at-a-glance hint.
function shortStatus(status: ThreadStatus): string {
    switch (status) {
        case 'accepted': return '✓'
        case 'rejected': return '✗'
        case 'submitted': return '…'
        case 'appealed': return '?'
        case 'ungraded':
        default: return '·'
    }
}

interface TeacherGridProps {
    centerID: number
    // Drives both the visual highlight and the "scroll me into the
    // viewport on mount" target. Pass null for "no selection".
    selectedSeriesID: number | null
    // Header click — parent updates selection (and typically opens the
    // side panel for that series).
    onSelectSeries?: (seriesID: number) => void
    // If provided, the grid renders a "+" header column after the last
    // series with this callback wired to it. Skipped when undefined so
    // the same component still works in read-only contexts.
    onCreateSeries?: () => void
}

// forwardRef + useImperativeHandle exposes a `reload()` so the parent
// can refresh the matrix after creating/editing/deleting a series
// without rendering its own copy of the data-fetching logic.
export const TeacherGrid = forwardRef<TeacherGridHandle, TeacherGridProps>(function TeacherGrid(props, ref) {
    const {centerID, selectedSeriesID, onSelectSeries, onCreateSeries} = props
    const {user, authedFetch} = useAuth()
    const navigate = useNavigate()
    const [data, setData] = useState<CenterGridResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            setData(await getCenterGrid(authedFetch, centerID))
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить')
        }
    }, [authedFetch, centerID])

    useImperativeHandle(ref, () => ({reload: load}), [load])

    useEffect(() => {
        void load()
    }, [load])

    // Container ref + per-series header ref so we can scroll the
    // selected series into view once the table has mounted. We bind the
    // ref only to the currently-selected series; scrollIntoView with
    // inline:'center' centres that block horizontally without nudging
    // the page vertically.
    const containerRef = useRef<HTMLDivElement | null>(null)
    const selectedSeriesRef = useRef<HTMLTableCellElement | null>(null)

    useEffect(() => {
        if (!data) return
        const el = selectedSeriesRef.current
        if (!el) return
        // 'auto' (not 'smooth') so the user lands directly on the right
        // pset; a smooth scroll would briefly flash an intermediate
        // series and feel disorienting on first paint.
        el.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'auto'})
    }, [data, selectedSeriesID])

    if (error) {
        return <Card><ErrorBanner message={error}/></Card>
    }
    if (!data) {
        return <Card><Subheading>Загрузка…</Subheading></Card>
    }
    if (data.groups.length === 0) {
        return (
            <Card>
                <Subheading>В этом матцентре пока нет учеников.</Subheading>
                {onCreateSeries ? (
                    <View style={{marginTop: 8, alignSelf: 'flex-start'} as any}>
                        <button onClick={onCreateSeries} style={primaryButtonStyle}>+ Создать серию</button>
                    </View>
                ) : null}
            </Card>
        )
    }

    const userID = user?.id ?? -1

    return (
        <Card style={{paddingVertical: 12, paddingHorizontal: 12}}>
            <div ref={containerRef} style={tableScrollStyle}>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th rowSpan={2} style={{...headerTopStyle, ...studentColStyle, textAlign: 'left'}}>
                                Ученик
                            </th>
                            {data.series.map(ser => {
                                const isSelected = ser.series_id === selectedSeriesID
                                return (
                                    <th
                                        key={ser.series_id}
                                        ref={isSelected ? selectedSeriesRef : null}
                                        colSpan={Math.max(1, ser.columns.length)}
                                        style={{
                                            ...seriesHeaderStyle,
                                            ...(isSelected ? currentSeriesHeaderStyle : null),
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => onSelectSeries?.(ser.series_id)}
                                    >
                                        {ser.display_name}
                                    </th>
                                )
                            })}
                            {onCreateSeries ? (
                                <th rowSpan={2} style={addColumnStyle}>
                                    <button
                                        onClick={onCreateSeries}
                                        title="Создать серию"
                                        style={addButtonStyle}
                                    >+</button>
                                </th>
                            ) : null}
                        </tr>
                        <tr>
                            {data.series.flatMap(ser => {
                                const isSelected = ser.series_id === selectedSeriesID
                                if (ser.columns.length === 0) {
                                    // Defensive: a series with no columns
                                    // (shouldn't happen — every problem has
                                    // at least the sentinel subproblem) would
                                    // otherwise collapse the parent colSpan.
                                    return [(
                                        <th key={`empty-${ser.series_id}`} style={{
                                            ...colHeaderStyle,
                                            ...(isSelected ? currentSeriesBodyStyle : null),
                                        }}>—</th>
                                    )]
                                }
                                return ser.columns.map(col => (
                                    <th
                                        key={col.subproblem_id}
                                        style={{
                                            ...colHeaderStyle,
                                            ...(isSelected ? currentSeriesBodyStyle : null),
                                        }}
                                    >
                                        {col.column_label}
                                    </th>
                                ))
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {data.groups.map(group => (
                            <GroupRows
                                key={group.group_id}
                                group={group}
                                series={data.series}
                                cells={data.cells}
                                currentSeriesID={selectedSeriesID}
                                userID={userID}
                                hasCreateCol={!!onCreateSeries}
                                onOpenThread={threadID => navigate(`/homework/threads/${threadID}`)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
            <View style={{marginTop: 8}}>
                <Text style={{fontSize: 12, color: colors.textMuted}}>
                    Кликните по заголовку серии, чтобы открыть её слева. Цветная клетка — задача в работе.
                </Text>
            </View>
        </Card>
    )
})

function GroupRows({group, series, cells, currentSeriesID, userID, hasCreateCol, onOpenThread}: {
    group: CenterGridResponse['groups'][number];
    series: CenterGridResponse['series'];
    cells: CenterGridResponse['cells'];
    currentSeriesID: number | null;
    userID: number;
    hasCreateCol: boolean;
    onOpenThread: (threadID: number) => void;
}) {
    // Total column count includes the student name column on the left
    // plus one per subproblem across every series plus the "+" column
    // (when the create-callback is provided). Used to size the group
    // separator <td>'s colSpan.
    const subCols = series.reduce((n, s) => n + Math.max(1, s.columns.length), 0)
    const totalCols = subCols + 1 + (hasCreateCol ? 1 : 0)
    return (
        <>
            <tr>
                <td colSpan={totalCols} style={groupHeaderStyle}>
                    Группа {group.name}
                </td>
            </tr>
            {group.students.map(stu => (
                <tr key={stu.user_id}>
                    <td style={studentNameStyle}>{stu.name}</td>
                    {series.flatMap(ser => {
                        const isCurrent = ser.series_id === currentSeriesID
                        if (ser.columns.length === 0) {
                            return [(
                                <td key={`empty-${ser.series_id}`} style={{
                                    ...cellStyle,
                                    ...(isCurrent ? currentSeriesBodyStyle : null),
                                }}/>
                            )]
                        }
                        return ser.columns.map(col => {
                            const cell = cells[centerGridCellKey(stu.user_id, col.subproblem_id)]
                            return (
                                <Cell
                                    key={col.subproblem_id}
                                    cell={cell}
                                    isCurrentSeries={isCurrent}
                                    userID={userID}
                                    onOpenThread={onOpenThread}
                                />
                            )
                        })
                    })}
                    {hasCreateCol ? <td style={addColumnPadStyle}/> : null}
                </tr>
            ))}
        </>
    )
}

function Cell({cell, isCurrentSeries, userID, onOpenThread}: {
    cell: CenterGridCell | undefined;
    isCurrentSeries: boolean;
    userID: number;
    onOpenThread: (threadID: number) => void;
}) {
    const status: ThreadStatus = cell?.current_status ?? 'ungraded'
    const threadID = cell?.thread_id ?? 0
    const interactive = threadID > 0
    const claimHolder = liveClaimHolder(cell)
    const claimedByMe = claimHolder === userID
    const claimedByOther = claimHolder != null && !claimedByMe

    const bg = statusBackgroundColor(status)
    const border = statusBorderColor(status)

    const baseCellStyle: React.CSSProperties = {
        ...cellStyle,
        background: bg,
        ...(isCurrentSeries ? currentSeriesBodyStyle : null),
    }
    const innerStyle: React.CSSProperties = {
        ...innerCellStyle,
        borderColor: border,
        ...(claimedByMe ? claimedByMeStyle : null),
        opacity: interactive ? 1 : 0.7,
        cursor: interactive ? 'pointer' : 'default',
    }
    return (
        <td style={baseCellStyle}>
            <div
                title={statusLabel(status)}
                onClick={interactive ? () => onOpenThread(threadID) : undefined}
                style={innerStyle}
            >
                <span style={glyphStyle}>{shortStatus(status)}</span>
                {claimedByOther ? <span style={otherClaimDot} title="Уже проверяет другой"/> : null}
            </div>
        </td>
    )
}

// --- Styles -----------------------------------------------------------------

const tableScrollStyle: React.CSSProperties = {
    overflowX: 'auto',
    overflowY: 'visible',
    maxWidth: '100%',
}

const tableStyle: React.CSSProperties = {
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: 12,
    color: colors.text,
}

const headerTopStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 12,
    padding: '8px 10px',
    background: '#f9fafb',
    borderBottom: `1px solid ${colors.border}`,
}

const studentColStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    minWidth: 180,
    background: '#f9fafb',
    borderRight: `1px solid ${colors.border}`,
}

const seriesHeaderStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 13,
    padding: '8px 8px',
    background: '#f9fafb',
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: `1px solid ${colors.border}`,
    textAlign: 'center',
    whiteSpace: 'nowrap',
}

// Visual highlight for the series this page is opened to. Top border +
// thicker side borders frame the whole series block; the body cells get
// the matching side borders via currentSeriesBodyStyle.
const currentSeriesHeaderStyle: React.CSSProperties = {
    background: '#eff6ff',
    borderTop: `2px solid ${colors.primary}`,
    borderLeft: `2px solid ${colors.primary}`,
    borderRight: `2px solid ${colors.primary}`,
    color: colors.primary,
}

const currentSeriesBodyStyle: React.CSSProperties = {
    background: '#eff6ff',
}

const colHeaderStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 11,
    padding: '4px 6px',
    background: '#f3f4f6',
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: `1px solid ${colors.border}`,
    textAlign: 'center',
    minWidth: 38,
}

const groupHeaderStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    padding: '6px 10px',
    background: '#f3f4f6',
    fontWeight: 700,
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderTop: `1px solid ${colors.border}`,
    borderBottom: `1px solid ${colors.border}`,
}

const studentNameStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    minWidth: 180,
    padding: '6px 10px',
    background: '#fff',
    borderRight: `1px solid ${colors.border}`,
    borderBottom: `1px solid #f3f4f6`,
    fontSize: 12,
    color: colors.text,
}

const cellStyle: React.CSSProperties = {
    padding: 3,
    borderBottom: `1px solid #f3f4f6`,
    textAlign: 'center',
}

const innerCellStyle: React.CSSProperties = {
    width: 32,
    height: 30,
    margin: '0 auto',
    borderRadius: 5,
    borderWidth: 1,
    borderStyle: 'solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
}

// Frame for cells the current user is actively grading. Stands out
// against the series highlight while still being readable.
const claimedByMeStyle: React.CSSProperties = {
    boxShadow: `0 0 0 2px ${colors.primary}`,
    borderColor: colors.primary,
}

const glyphStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    color: colors.text,
}

// Small dot in the top-right corner to flag "claimed by someone else"
// without taking up cell real estate.
const otherClaimDot: React.CSSProperties = {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 5,
    height: 5,
    borderRadius: 999,
    background: '#92400e',
}

// "+" column at the end of the series headers — the entry point for
// "create a new series". Borders match the series-block treatment.
const addColumnStyle: React.CSSProperties = {
    padding: 0,
    background: '#f9fafb',
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: `1px solid ${colors.border}`,
    minWidth: 48,
    verticalAlign: 'middle',
    textAlign: 'center',
}

const addColumnPadStyle: React.CSSProperties = {
    borderLeft: `1px solid ${colors.border}`,
    background: '#fafbfc',
}

const addButtonStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    margin: 6,
    borderRadius: 8,
    border: `1px dashed ${colors.primary}`,
    background: '#fff',
    color: colors.primary,
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    lineHeight: 1,
}

const primaryButtonStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    background: colors.primary,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
}
