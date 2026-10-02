'use client';
import { useParams } from 'next/navigation';
import Workspace from '@/components/Workspace';
export default function CustomerPage(){const {token}=useParams<{token:string}>();return <Workspace customerToken={token}/>;}
