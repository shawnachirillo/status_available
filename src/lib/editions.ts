export type EditionTier = 'Open' | 'Limited' | 'Original';
export type Edition = { slug: string; name: string; tier: EditionTier; category: string; description: string; background: string; foreground: string; accent: string; displayTitle: string; };
// Demonstration content only: not inventory, licensed templates, or purchasable products.
export const editions: Edition[] = [
  {slug:'atelier',name:'Atelier',tier:'Open',category:'Creative practice',description:'A composed digital home for creative practices and independent studios.',background:'#d5c9b8',foreground:'#302e2b',accent:'#d9a46f',displayTitle:'A quieter kind of bold.'},
  {slug:'stillform',name:'Stillform',tier:'Limited',category:'Wellness & lifestyle',description:'An editorial introduction for thoughtful service businesses.',background:'#a9b4a3',foreground:'#283c32',accent:'#f1eee5',displayTitle:'Make room for ritual.'},
  {slug:'maison',name:'Maison',tier:'Original',category:'Hospitality & interiors',description:'A distinctive one-page concept for places with a point of view.',background:'#c1a08c',foreground:'#492a26',accent:'#f4e6d8',displayTitle:'A place to belong.'}
];
export function getEdition(slug:string){return editions.find(edition=>edition.slug===slug)}
