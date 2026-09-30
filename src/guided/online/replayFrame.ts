/** rAF timestamps can precede effect setup in the same display frame. */
export function replayFrame(now:number,start:number,count:number,interval:number) {
  if(count<1||interval<=0)return 0
  return Math.max(0,Math.min(count-1,Math.floor((now-start)/interval)))
}
