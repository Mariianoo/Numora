/**
 * app/page.tsx
 * Tela inicial — simples, sem estilização avançada.
 */
import Link from 'next/link'

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Numora</h1>
      <div className="flex gap-4">
        <Link href="/login" className="border px-4 py-2">
          Login
        </Link>
        <Link href="/dashboard" className="border px-4 py-2">
          Dashboard
        </Link>
      </div>
    </div>
  )
}
