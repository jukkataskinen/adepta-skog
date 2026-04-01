import { auth0 } from '@/lib/auth0'
import { redirect } from 'next/navigation'
import KirjanpitoClient from './KirjanpitoClient'

export default async function KirjanpitoPage() {
  const session = await auth0.getSession()
  if (!session?.user) redirect('/auth/login')
  return <KirjanpitoClient />
}
