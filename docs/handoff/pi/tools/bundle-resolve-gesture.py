import re,sys
p='tests/games-gesture.test.mjs'; s=open(p).read()
def fix(m):
    ours,theirs=m.group(1),m.group(2)
    if 'function killGlyph' in theirs and 'function killGlyph' in ours:
        tk=[l for l in theirs.splitlines() if l.startswith('function killGlyph')][0]
        rest=[l for l in ours.splitlines() if not l.startswith('function killGlyph')]
        return tk+'\n'+'\n'.join(rest)+'\n'
    if 'new Moonrunner(makeCtx(25))' in ours and 'new Undertow' in theirs:
        und=[l for l in theirs.splitlines() if 'new Undertow' in l][0]
        return '\n'.join(l for l in ours.splitlines() if 'new Undertow' not in l)+'\n'+und+'\n'
    if 'recorded inside the gesture window' in ours and 'recorded inside the gesture window' in theirs:
        return ('    // Undertow and Glyph Archive hold their records with AppGuard (engine/input.js), whose window closes as\n'
                '    // soon as no gesture can still be under way; the others wait out GestureGuard\'s SETTLE.\n'
                '    step(g, name === "Undertow" ? 0.1 : 0.5);\n'
                '    if (name !== "Glyph Archive") assert.equal(c.log.saves.length, 0, name + " recorded inside the gesture window");\n'
                # the wait that follows, when the hunk reached it (the platform draft lengthened it): keep the longer one
                + ''.join(sorted((l + '\n' for l in (ours + theirs).splitlines() if re.fullmatch(r'\s*step\(g, [\d.]+\);', l)),
                                 key=lambda l: float(re.search(r'[\d.]+(?=\))', l).group()))[-1:]))
    print('UNKNOWN HUNK:\n'+m.group(0)); sys.exit(1)
s2=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', fix, s, flags=re.S)
assert '<<<<<<<' not in s2
open(p,'w').write(s2); print('resolved games-gesture')
