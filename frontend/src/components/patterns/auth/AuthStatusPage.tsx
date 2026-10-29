import { useEffect,useId,useRef,type ReactNode } from 'react';
export default function AuthStatusPage({title,description,children,busy=false,brand,deferStatus=false,reserveActions=false}:{title:string;description?:string;children?:ReactNode;busy?:boolean;brand:ReactNode;deferStatus?:boolean;reserveActions?:boolean}) {
 const heading=useRef<HTMLHeadingElement>(null),id=useId();
 useEffect(() => {if(!deferStatus)heading.current?.focus();},[title,deferStatus]);
 return <main className="grid min-h-svh place-items-center bg-background p-4 sm:p-6">
  <section aria-labelledby={id} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
   <div className="mb-8">{brand}</div>
   <h1 id={id} ref={heading} tabIndex={-1} aria-hidden={deferStatus||undefined} className={`${deferStatus?'invisible ':''}text-xl font-semibold tracking-tight outline-none`}>{title}</h1>
   <p aria-hidden={deferStatus||undefined} role={busy?'status':'alert'} className={`${deferStatus?'invisible ':''}${reserveActions?'min-h-12 ':''}mt-3 text-sm leading-6 text-muted-foreground`}>{description??title}</p>
   {(children||reserveActions)&&<div className={`${reserveActions?'min-h-9 ':''}mt-6 flex flex-col gap-3`}>{children}</div>}
  </section>
 </main>;
}
