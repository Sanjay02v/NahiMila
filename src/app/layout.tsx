import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'NahiMila — Turn “not available” into opportunity',description:'Exact customer reservations. Shared supplier cases. Cash-safe decisions for neighbourhood merchants.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
