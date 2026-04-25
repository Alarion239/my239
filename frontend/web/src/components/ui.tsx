import {ReactNode} from 'react'
import {Pressable, StyleSheet, Text, TextInput, View, ViewStyle} from 'react-native'

// Tiny RN primitives wrapped with the project's visual baseline. Centralizing
// these keeps every page consistent without pulling in a UI library.

export const colors = {
    bg: '#f5f6f8',
    surface: '#ffffff',
    border: '#e1e4ea',
    text: '#1f2933',
    textMuted: '#6b7280',
    primary: '#2563eb',
    primaryPressed: '#1e40af',
    danger: '#dc2626',
    ok: '#15803d',
}

export function Card({children, style}: { children: ReactNode; style?: ViewStyle }) {
    return <View style={[s.card, style]}>{children}</View>
}

export function Heading({children}: { children: ReactNode }) {
    return <Text style={s.heading}>{children}</Text>
}

export function Subheading({children}: { children: ReactNode }) {
    return <Text style={s.subheading}>{children}</Text>
}

export function Field(props: {
    label: string
    value: string
    onChangeText: (v: string) => void
    placeholder?: string
    secureTextEntry?: boolean
    autoCapitalize?: 'none' | 'sentences'
    error?: string
}) {
    return (
        <View style={{marginBottom: 12}}>
            <Text style={s.label}>{props.label}</Text>
            <TextInput
                style={[s.input, props.error ? s.inputError : null]}
                value={props.value}
                onChangeText={props.onChangeText}
                placeholder={props.placeholder}
                placeholderTextColor={colors.textMuted}
                secureTextEntry={props.secureTextEntry}
                autoCapitalize={props.autoCapitalize ?? 'none'}
            />
            {props.error ? <Text style={s.errorText}>{props.error}</Text> : null}
        </View>
    )
}

export function Button(props: {
    title: string
    onPress: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
}) {
    const {title, onPress, disabled, variant = 'primary'} = props
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            style={({pressed}) => [
                s.button,
                variant === 'secondary' && s.buttonSecondary,
                variant === 'danger' && s.buttonDanger,
                pressed && variant === 'primary' && {backgroundColor: colors.primaryPressed},
                disabled && {opacity: 0.5},
            ]}
        >
            <Text style={[s.buttonText, variant === 'secondary' && {color: colors.text}]}>{title}</Text>
        </Pressable>
    )
}

export function ErrorBanner({message}: { message: string }) {
    return (
        <View style={s.errorBanner}>
            <Text style={s.errorBannerText}>{message}</Text>
        </View>
    )
}

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 24,
    },
    heading: {fontSize: 22, fontWeight: '600', color: colors.text, marginBottom: 8},
    subheading: {fontSize: 14, color: colors.textMuted, marginBottom: 20},
    label: {fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6},
    input: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 15,
        color: colors.text,
        backgroundColor: '#fff',
    },
    inputError: {borderColor: colors.danger},
    errorText: {color: colors.danger, fontSize: 12, marginTop: 4},
    button: {
        backgroundColor: colors.primary,
        borderRadius: 8,
        paddingVertical: 11,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonSecondary: {backgroundColor: '#eef2f7'},
    buttonDanger: {backgroundColor: colors.danger},
    buttonText: {color: '#fff', fontSize: 15, fontWeight: '600'},
    errorBanner: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        marginBottom: 12,
    },
    errorBannerText: {color: colors.danger, fontSize: 13},
})
