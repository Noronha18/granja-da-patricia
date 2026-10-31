// Maps URLs launches navigation without a server API key or a paid calculation.
// https://developers.google.com/maps/documentation/urls/get-started
export function navigationUrl(destination:{address:string}|{lat:number;lng:number}):string {
 let target:string;
 if ('address' in destination) {
  target=destination.address.trim();
  if(!target||target.length>500)throw new RangeError('Invalid destination');
 }else{
  if(!Number.isFinite(destination.lat)||!Number.isFinite(destination.lng)||Math.abs(destination.lat)>90||Math.abs(destination.lng)>180)throw new RangeError('Invalid destination');
  target=`${destination.lat},${destination.lng}`;
 }
 const url=new URL('https://www.google.com/maps/dir/');
 url.search=new URLSearchParams({api:'1',destination:target,travelmode:'driving',dir_action:'navigate'}).toString();
 return url.href;
}
