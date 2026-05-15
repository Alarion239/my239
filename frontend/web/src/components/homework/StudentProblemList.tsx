// StudentProblemList renders one card per problem with a tile per
// subproblem. Pure-presentation — the parent owns data fetching, so the
// same problem list can be reused inside the responsive split next to the
// PDF preview.

import {Pressable, StyleSheet, Text, View} from 'react-native'
import {useNavigate} from 'react-router-dom'
import {
    type RollupProblem,
    type RollupSubproblem,
    statusBackgroundColor,
    statusBorderColor,
    statusLabel,
} from '../../api/homework'
import {Card, colors, Heading, Subheading} from '../ui'

interface Props {
    problems: RollupProblem[]
    // When the series has already closed, ungraded tiles (no thread yet)
    // are unclickable — there's nothing useful to show on the new-
    // submission page once submissions are no longer accepted. Existing
    // threads remain clickable so the student can still see their
    // history and submit appeals.
    closed: boolean
}

export function StudentProblemList({problems, closed}: Props) {
    const navigate = useNavigate()
    if (problems.length === 0) {
        return <Card><Subheading>В этой серии нет задач.</Subheading></Card>
    }
    return (
        <View style={{gap: 12} as any}>
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
        </View>
    )
}

function ProblemCard({problem, closed, onOpen}: {problem: RollupProblem; closed: boolean; onOpen: (sub: RollupSubproblem) => void}) {
    return (
        <Card style={{paddingVertical: 12, paddingHorizontal: 16}}>
            <View style={s.problemHeaderRow}>
                <Heading>{problem.problem_display}</Heading>
                <View style={s.tilesRow}>
                    {problem.subproblems.map(sub => (
                        <SubproblemTile
                            key={sub.subproblem_id}
                            sub={sub}
                            disabled={closed && sub.thread_id === 0}
                            onOpen={() => onOpen(sub)}
                        />
                    ))}
                </View>
            </View>
        </Card>
    )
}

// SubproblemTile is intentionally small — just enough to show the letter
// (or a status icon for problems without real subparts) and to communicate
// the current status via background+border colors. The full status name
// is the title attribute, so power users hovering get the long-form label
// without us having to lay out text inside a 36-pixel box.
//
// `disabled` mutes the tile visually and disables press feedback so
// students don't try to click "Не решена" cells on closed series.
function SubproblemTile({sub, disabled, onOpen}: {sub: RollupSubproblem; disabled: boolean; onOpen: () => void}) {
    const bg = statusBackgroundColor(sub.current_status)
    const border = statusBorderColor(sub.current_status)
    // Sentinel subproblems (label='') get a status glyph in place of the
    // letter; the parent card heading "Задача N" already names the tile.
    const glyph = sub.subproblem_label || statusGlyph(sub.current_status)
    return (
        <Pressable
            onPress={onOpen}
            disabled={disabled}
            // `title` is forwarded to the underlying <div> by RN-web and
            // renders as a browser tooltip — free affordance.
            // @ts-expect-error RN's typing doesn't expose DOM title
            title={statusLabel(sub.current_status)}
            style={({pressed}) => [
                s.tile,
                {backgroundColor: bg, borderColor: border},
                pressed && !disabled && {opacity: 0.85},
                disabled && {opacity: 0.6},
            ]}
        >
            <Text style={s.tileLabel}>{glyph}</Text>
        </Pressable>
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
            // Empty circle reads as "nothing here yet" universally and
            // is what we want students to associate with "Не решена".
            return '○'
    }
}

const s = StyleSheet.create({
    problemHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
    } as any,
    tilesRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6} as any,
    tile: {
        width: 36,
        height: 36,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileLabel: {fontSize: 14, fontWeight: '700', color: colors.text, lineHeight: 16},
})
