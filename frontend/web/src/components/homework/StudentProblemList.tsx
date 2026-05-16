// StudentProblemList renders one card per problem with a tile per
// subproblem. Pure-presentation — the parent owns data fetching, so
// the same problem list can be reused inside the responsive split next
// to the PDF preview.

import {useNavigate} from 'react-router-dom'
import {
    type RollupProblem,
    type RollupSubproblem,
    statusBackgroundColor,
    statusBorderColor,
    statusLabel,
} from '../../api/homework'
import {Card, Heading, Subheading} from '../ui'

interface Props {
    problems: RollupProblem[]
    // When the series has already closed, ungraded tiles (no thread
    // yet) are unclickable — there's nothing useful to show on the
    // new-submission page once submissions are no longer accepted.
    // Existing threads remain clickable so the student can still see
    // their history and submit appeals.
    closed: boolean
}

export function StudentProblemList({problems, closed}: Props) {
    const navigate = useNavigate()
    if (problems.length === 0) {
        return <Card><Subheading>В этой серии нет задач.</Subheading></Card>
    }
    return (
        <div className="flex flex-col gap-3">
            {problems.map(p => (
                <ProblemCard
                    key={p.problem_id}
                    problem={p}
                    closed={closed}
                    onOpen={sub => {
                        if (sub.thread_id > 0) {
                            navigate(`/homework/threads/${sub.thread_id}`)
                            return
                        }
                        if (closed) return // no useful destination
                        navigate(`/homework/new/${sub.subproblem_id}`)
                    }}
                />
            ))}
        </div>
    )
}

function ProblemCard({problem, closed, onOpen}: {
    problem: RollupProblem
    closed: boolean
    onOpen: (sub: RollupSubproblem) => void
}) {
    return (
        <Card className="!py-3 !px-4">
            <div className="flex flex-wrap items-center gap-2.5">
                <Heading>{problem.problem_display}</Heading>
                <div className="flex flex-wrap gap-1.5">
                    {problem.subproblems.map(sub => (
                        <SubproblemTile
                            key={sub.subproblem_id}
                            sub={sub}
                            disabled={closed && sub.thread_id === 0}
                            onOpen={() => onOpen(sub)}
                        />
                    ))}
                </div>
            </div>
        </Card>
    )
}

// SubproblemTile is intentionally small — just enough to show the
// letter (or a status icon for problems without real subparts) and to
// communicate the current status via background+border colors. The
// full status name is the title attribute, so power users hovering
// get the long-form label without us having to lay out text inside a
// 36-pixel box.
//
// `disabled` mutes the tile visually so students don't try to click
// "Не решена" cells on closed series.
function SubproblemTile({sub, disabled, onOpen}: {
    sub: RollupSubproblem
    disabled: boolean
    onOpen: () => void
}) {
    const bg = statusBackgroundColor(sub.current_status)
    const border = statusBorderColor(sub.current_status)
    // Sentinel subproblems (label='') get a status glyph in place of
    // the letter; the parent card heading "Задача N" already names
    // the tile.
    const glyph = sub.subproblem_label || statusGlyph(sub.current_status)
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            title={statusLabel(sub.current_status)}
            className={`w-9 h-9 rounded-md border flex items-center justify-center transition-opacity ${
                disabled ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-85'
            }`}
            style={{backgroundColor: bg, borderColor: border}}
        >
            <span className="text-sm font-bold text-ink leading-none">{glyph}</span>
        </button>
    )
}

function statusGlyph(status: RollupSubproblem['current_status']): string {
    switch (status) {
        case 'accepted': return '✓'
        case 'rejected': return '✗'
        case 'submitted': return '…'
        case 'appealed': return '?'
        case 'ungraded':
        default:
            // Empty circle reads as "nothing here yet" universally —
            // what we want students to associate with "Не решена".
            return '○'
    }
}
