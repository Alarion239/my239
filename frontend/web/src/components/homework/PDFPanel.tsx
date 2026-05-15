// PDFPanel is the shared "embed the series PDF" surface for the student
// homework view. On a laptop the parent uses it as the left column of a
// responsive split (with sticky positioning so the PDF stays visible while
// the student scrolls through problem cards). On a phone the parent stacks
// it above the problem list — we just render a normal-flow box with a
// generous fixed height there.
//
// Uses fetchSeriesPDFObjectURL so the bearer-authed GET is converted into a
// blob: URL that <iframe> can render. We own the URL and revoke it on
// unmount or seriesID change to avoid leaking object URLs across pages.

import {useEffect, useState} from 'react'
import {Text, View} from 'react-native'
import {fetchSeriesPDFObjectURL} from '../../api/series'
import {useAuth} from '../../auth'
import {colors} from '../ui'

interface PDFPanelProps {
    seriesID: number
    hasPDF: boolean
    // When true, the panel position-sticks to the viewport top so it remains
    // visible while the student scrolls the problem list (desktop). When
    // false, it lays out in normal flow with a fixed height — used on mobile
    // where the PDF stacks above the problems.
    sticky: boolean
}

export function PDFPanel({seriesID, hasPDF, sticky}: PDFPanelProps) {
    const {authedFetchRaw} = useAuth()
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!hasPDF) {
            setUrl(null)
            return
        }
        let cancelled = false
        let owned: string | null = null
        setError(null)
        fetchSeriesPDFObjectURL(authedFetchRaw, seriesID)
            .then(u => {
                if (cancelled) {
                    URL.revokeObjectURL(u)
                    return
                }
                owned = u
                setUrl(u)
            })
            .catch(e => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить PDF')
            })
        return () => {
            cancelled = true
            if (owned) URL.revokeObjectURL(owned)
            setUrl(null)
        }
    }, [seriesID, hasPDF, authedFetchRaw])

    // The outer box decides sticky vs. flow positioning. Sticky needs an
    // explicit height so the iframe has something to fill; we use the
    // viewport so the PDF takes the full visible height minus the nav bar.
    const outerStyle: React.CSSProperties = sticky
        ? {
              position: 'sticky',
              top: 16,
              height: 'calc(100vh - 120px)',
              minHeight: 480,
              display: 'flex',
              flexDirection: 'column',
          }
        : {
              height: 'min(70vh, 540px)',
              minHeight: 320,
              display: 'flex',
              flexDirection: 'column',
          }

    if (!hasPDF) {
        return (
            <div style={outerStyle}>
                <Placeholder>PDF ещё не загружен.</Placeholder>
            </div>
        )
    }
    if (error) {
        return (
            <div style={outerStyle}>
                <Placeholder color={colors.danger}>{error}</Placeholder>
            </div>
        )
    }
    if (!url) {
        return (
            <div style={outerStyle}>
                <Placeholder>Загрузка PDF…</Placeholder>
            </div>
        )
    }
    return (
        <div style={outerStyle}>
            <iframe
                src={url}
                title="Серия — PDF"
                style={{
                    flex: 1,
                    width: '100%',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    background: '#fff',
                    display: 'block',
                }}
            />
        </div>
    )
}

function Placeholder({children, color = colors.textMuted}: {children: React.ReactNode; color?: string}) {
    return (
        <View style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bg,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            borderStyle: 'dashed',
            padding: 24,
        }}>
            <Text style={{fontSize: 14, color, textAlign: 'center'}}>{children}</Text>
        </View>
    )
}
