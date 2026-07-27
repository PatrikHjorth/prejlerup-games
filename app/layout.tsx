import './globals.css'

export const metadata = {
  title: 'Prejlerup Games',
  description: 'Live predictions og virtuelle credits'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="da"><body>{children}</body></html>
}
