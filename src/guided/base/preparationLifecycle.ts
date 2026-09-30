const terminalPhases=new Set(['checking','idle','ready','error'])

export function isActivePreparation(phase:string, hasController:boolean){
  return hasController&&!terminalPhases.has(phase)
}
