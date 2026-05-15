// Root layout: wraps every route in the AuthProvider, then has a
// small gate component that redirects between (tabs) and /login based
// on auth state. Public-feeling pages (login itself, the modal demo)
// live outside the (tabs) group and aren't gated.

import {DarkTheme, DefaultTheme, ThemeProvider} from '@react-navigation/native'
import {Stack, useRouter, useSegments} from 'expo-router'
import {StatusBar} from 'expo-status-bar'
import {useEffect} from 'react'
import 'react-native-reanimated'

import {useColorScheme} from '@/hooks/use-color-scheme'
import {AuthProvider, useAuth} from '@/lib/auth'

export const unstable_settings = {
    anchor: '(tabs)',
}

export default function RootLayout() {
    const colorScheme = useColorScheme()

    return (
        <AuthProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <Stack>
                    <Stack.Screen name="(tabs)" options={{headerShown: false}}/>
                    <Stack.Screen name="login" options={{headerShown: false}}/>
                    <Stack.Screen name="modal" options={{presentation: 'modal', title: 'Modal'}}/>
                </Stack>
                <StatusBar style="auto"/>
                <AuthGate/>
            </ThemeProvider>
        </AuthProvider>
    )
}

// AuthGate watches the current segment vs the auth state and bounces
// the user between /login and /(tabs) when they don't match. Keeps
// every screen file ignorant of auth routing — they just render and
// the gate handles the redirect side-effect.
function AuthGate() {
    const {user, loading} = useAuth()
    const segments = useSegments()
    const router = useRouter()

    useEffect(() => {
        if (loading) return
        const onLogin = segments[0] === 'login'
        if (!user && !onLogin) {
            router.replace('/login')
        } else if (user && onLogin) {
            router.replace('/(tabs)')
        }
    }, [user, loading, segments, router])

    return null
}
