// Bootstrap home screen: shows the backend connectivity status so you
// can confirm the device can reach the API before we build any real
// screens (login, mathcenter, homework) on top.
//
// Configure the backend URL in app.json → expo.extra.backendURL or via
// the EXPO_PUBLIC_BACKEND_URL env var. iOS simulator can use
// http://localhost:8080; a physical iPhone over the same Wi-Fi needs the
// dev machine's LAN IP.

import {useEffect, useState} from 'react'
import {StyleSheet} from 'react-native'

import ParallaxScrollView from '@/components/parallax-scroll-view'
import {ThemedText} from '@/components/themed-text'
import {ThemedView} from '@/components/themed-view'
import {BACKEND_URL, pingHealth} from '@/lib/api'

type ConnState = 'checking' | 'ok' | 'fail'

export default function HomeScreen() {
    const [state, setState] = useState<ConnState>('checking')

    useEffect(() => {
        let cancelled = false
        pingHealth()
            .then(ok => {
                if (!cancelled) setState(ok ? 'ok' : 'fail')
            })
            .catch(() => {
                if (!cancelled) setState('fail')
            })
        return () => {
            cancelled = true
        }
    }, [])

    return (
        <ParallaxScrollView
            headerBackgroundColor={{light: '#A1CEDC', dark: '#1D3D47'}}
            headerImage={<ThemedText type="title" style={styles.headerLabel}>my239</ThemedText>}
        >
            <ThemedView style={styles.section}>
                <ThemedText type="title">Мобильный клиент</ThemedText>
                <ThemedText>
                    Это бутстрап-приложение Expo. На iPhone и Android в проде здесь будут логин и страницы матцентра.
                </ThemedText>
            </ThemedView>

            <ThemedView style={styles.section}>
                <ThemedText type="subtitle">Backend</ThemedText>
                <ThemedText style={styles.code}>{BACKEND_URL}</ThemedText>
                <StatusLine state={state}/>
            </ThemedView>

            <ThemedView style={styles.section}>
                <ThemedText type="subtitle">Что дальше</ThemedText>
                <ThemedText>1. Поменять backendURL в <ThemedText type="defaultSemiBold">app.json</ThemedText> на IP машины разработки для физического устройства.</ThemedText>
                <ThemedText>2. Добавить экраны логина и матцентра, повторно используя домены из <ThemedText type="defaultSemiBold">frontend/web/src/api</ThemedText>.</ThemedText>
                <ThemedText>3. Запустить симулятор: <ThemedText type="defaultSemiBold">npm run ios</ThemedText>.</ThemedText>
            </ThemedView>
        </ParallaxScrollView>
    )
}

function StatusLine({state}: {state: ConnState}) {
    if (state === 'checking') return <ThemedText style={styles.checking}>Проверяем соединение…</ThemedText>
    if (state === 'ok') return <ThemedText style={styles.ok}>✓ Соединение с бэкендом установлено</ThemedText>
    return (
        <ThemedText style={styles.fail}>
            ✗ Не удалось подключиться. Проверьте, что бэкенд запущен и URL выше доступен с устройства.
        </ThemedText>
    )
}

const styles = StyleSheet.create({
    headerLabel: {color: '#fff', position: 'absolute', bottom: 16, left: 16},
    section: {gap: 8, marginBottom: 12},
    code: {fontFamily: 'Courier', fontSize: 14, color: '#374151'},
    checking: {color: '#6b7280'},
    ok: {color: '#15803d', fontWeight: '600'},
    fail: {color: '#dc2626', fontWeight: '600'},
})
