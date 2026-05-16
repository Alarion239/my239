// ProgressBadges renders the four-state breakdown on the right of a
// series header. Each badge's label agrees in number with its count:
//   1 Принята / 2 Приняты, 1 Не решена / 0 Не решены, etc.
// The count is the visual focal point so the number is bigger; the
// label sits to its right in caps for compactness.

import {ruPlural, type GranularCounts} from '../../api/homework'

export function ProgressBadges({counts}: {counts: GranularCounts}) {
    return (
        <div className="flex flex-wrap gap-1.5">
            <Badge value={counts.accepted} singular="Принята" plural="Приняты" color="text-[#15803d]" bg="bg-[#d1fae5]"/>
            <Badge value={counts.rejected} singular="Отклонена" plural="Отклонены" color="text-[#dc2626]" bg="bg-[#fee2e2]"/>
            <Badge value={counts.checking} singular="Проверяется" plural="Проверяются" color="text-[#92400e]" bg="bg-[#fef3c7]"/>
            <Badge value={counts.not_solved} singular="Не решена" plural="Не решены" color="text-[#374151]" bg="bg-[#e5e7eb]"/>
        </div>
    )
}

function Badge({value, singular, plural, color, bg}: {
    value: number
    singular: string
    plural: string
    color: string
    bg: string
}) {
    return (
        <div className={`flex items-baseline gap-1.5 rounded-full px-2.5 py-1 ${bg}`}>
            <span className={`text-[15px] font-bold ${color}`}>{value}</span>
            <span className={`text-[10px] font-semibold tracking-wide ${color}`}>
                {ruPlural(value, singular, plural)}
            </span>
        </div>
    )
}
