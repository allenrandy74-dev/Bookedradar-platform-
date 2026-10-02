from pathlib import Path
from html.parser import HTMLParser
import unittest
ROOT=Path(__file__).parent/'src'
class Document(HTMLParser):
 def __init__(self,text):
  super().__init__();self.links=[];self.ids=[];self.stack=[];self.visible=[];self.feed(text)
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if a.get('id'):self.ids.append(a['id'])
  if tag=='a':self.links.append(a.get('href',''))
  if tag not in ['meta','link','br','hr','input','img','source','wbr']:self.stack.append((tag,a.get('aria-hidden')=='true'))
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==tag:self.stack=self.stack[:i];break
 def handle_data(self,text):
  if not any(h for _,h in self.stack):self.visible.append(text)
class WebsiteTests(unittest.TestCase):
 def setUp(self):self.home=(ROOT/'index.html').read_text();self.doc=Document(self.home);self.terms=(ROOT/'terms.html').read_text()
 def test_signup_copy(self):
  self.assertIn('Three required fields',self.home);self.assertIn('Phone contact is optional',self.home);self.assertNotIn('Five fields',self.home)
 def test_all_pilot_ctas_are_direct(self):
  import re
  ctas=re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(?:Start online|Request a pilot online)',self.home)
  self.assertEqual(len(ctas),5);self.assertEqual(set(ctas),{'https://bookedradar-platform.onrender.com/dashboard/signup.html'})
 def test_local_links_and_fragments(self):
  for f in ROOT.glob('*.html'):
   for href in Document(f.read_text()).links:
    if ':' in href or href.startswith('//'):continue
    path,_,fragment=href.partition('#');dest=(ROOT/'index.html') if path=='/' else (ROOT/path.lstrip('/')) if path else f
    self.assertTrue(dest.is_file(),f'{f.name}: {href}')
    if fragment:self.assertIn(fragment,Document(dest.read_text()).ids,f'{f.name}: {href}')
 def test_unique_ids(self):self.assertEqual(len(self.doc.ids),len(set(self.doc.ids)))
 def test_decorative_arrows_hidden(self):
  text=''.join(self.doc.visible)
  for glyph in ['↗','↓','✓']:self.assertNotIn(glyph,text)
 def test_demo_integrity(self):self.assertEqual(len([x for x in self.doc.links if x.startswith('tel:')]),5);self.assertIn('not requesting real service',self.home)
 def test_prices_preserved(self):
  for p in ['$149','$497','$397','$697','$597','$897','$797']:self.assertIn(p,self.home)
 def test_pilot_commercial_alignment(self):
  self.assertNotIn('A paid pilot',self.terms);self.assertIn('14 days or 25 real calls',self.terms);self.assertIn('any evaluation and provider costs are agreed separately',self.home);self.assertIn('no automatic paid conversion',self.terms)
 def test_customer_next_step(self):self.assertIn('What happens after I request a pilot?',self.home);self.assertIn('Real traffic starts only after acceptance testing and your approval',self.home)
 def test_built_sources_match(self):
  for f in ROOT.iterdir():
   if f.is_file():self.assertEqual(f.read_bytes(),(ROOT.parent/'dist'/f.name).read_bytes())
 def test_sitemap_alias(self):self.assertEqual((ROOT/'sitemap.xml').read_bytes(),(ROOT.parent/'dist/sitemap-index.xml').read_bytes())
 def test_reduced_motion_preserved(self):self.assertIn('prefers-reduced-motion:reduce',(ROOT/'homepage.css').read_text())
if __name__=='__main__':unittest.main(verbosity=2)
