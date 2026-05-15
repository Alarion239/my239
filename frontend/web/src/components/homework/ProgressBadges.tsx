// ProgressBadges renders the four-state breakdown on the right of a
// series header. Each badge's label agrees in number with its count:
//   1 Принята / 2 Приняты, 1 Не решена / 0 Не решены, etc.
// The count is the visual focal point so the number is bigger; the label
// sits to its right in caps for compactness.

import {StyleSheet, Text, View} from 'react-native'
import {ruPlural, type GranularCounts} from '../../api/homework'

export function ProgressBadges({counts}: {counts: GranularCounts}) {
    return (
        <View style={s.row}>
            <Badge
                value={counts.accepted}
                singular="Принята"
                plural="Приняты"
                color="#15803d"
                bg="#d1fae5"
            />
            <Badge
                value={counts.rejected}
                singular="Отклонена"
                plural="Отклонены"
                color="#dc2626"
                bg="#fee2e2"
            />
            <Badge
                value={counts.checking}
                singular="Проверяется"
                plural="Проверяются"
                color="#92400e"
                bg="#fef3c7"
            />
            <Badge
                value={counts.not_solved}
                singular="Не решена"
                plural="Не решены"
                color="#374151"
                bg="#e5e7eb"
            />
        </View>
    )
}

function Badge({value, singular, plural, color, bg}: {
    value: number;
    singular: string;
    plural: string;
    color: string;
    bg: string;
}) {
    return (
        <View style={[s.badge, {backgroundColor: bg}]}>
            <Text style={[s.value, {color}]}>{value}</Text>
            <Text style={[s.label, {color}]}>{ruPlural(value, singular, plural)}</Text>
        </View>
    )
}

const s = StyleSheet.create({
    row: {flexDirection: 'row', gap: 6, flexWrap: 'wrap'} as any,
    badge: {
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        gap: 5,
    } as any,
    value: {fontSize: 15, fontWeight: '700'},
    label: {fontSize: 10, fontWeight: '600', letterSpacing: 0.3},
})
