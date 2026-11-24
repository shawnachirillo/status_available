'use client';

import { SignUpButton, UserButton, useUser } from '@clerk/nextjs';
import { editions } from '@/lib/editions';
import { EditionCard } from '@/components/edition-card';
export default function Home(){const { isLoaded, isSignedIn } = useUser(); return <><div style={{position:"fixed",top:16,right:16,zIndex:1000}}>
  {isLoaded && (isSignedIn ? (
    <UserButton />
  ) : (
    <SignUpButton mode="modal">
      <button type="button" style={{padding:"12px 18px",background:"#222",color:"#fff",border:0,borderRadius:4,cursor:"pointer"}}>
        Create account
      </button>
    </SignUpButton>
  ))}
</div>
      <main className="shell"><section className="hero"><div><span className="eyebrow">A curated collection of digital spaces</span><h1 className="serif">Make your<br/><i>presence</i><br/>known.</h1></div><div><p>Distinctive one-page websites, designed with intention and made your own. Select an Edition. Shape the details. Take it live.</p><a className="button" href="#editions">Explore the Editions ↗</a></div></section><div className="rule"/><section id="editions"><div className="sectionhead"><div><span className="eyebrow">The collection / 001</span><h2>Find your starting point.</h2></div><span className="muted">Concept Editions · Preview only</span></div><div className="editions">{editions.map(e=><EditionCard key={e.slug} edition={e}/>)}</div></section></main></>}
