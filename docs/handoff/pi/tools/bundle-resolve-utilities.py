"""web/apps/utilities.js when the tap draft (PR #4) meets the platform draft (PR #16): both rewrote the
Settings page (#16: timing calibration; #4: TAP DIRECTION). Keep both. Unknown hunks stop the bundle."""
import re
import sys

p = "web/apps/utilities.js"
s = open(p).read()
END = "    this.render();\n  }\n"


def fix(m):
    ours, theirs = m.group(1), m.group(2)
    if "lampCount" in ours and "knockReadout" in theirs:      # Diagnostics.render() locals
        return ours.rstrip().rstrip(";") + ",\n" + theirs
    if "RENDER_NEXT" in ours and "TAP_SIDES" in theirs:        # module-level additions
        return ours + theirs
    if "startSync()" in ours and "tapCommand(" in theirs:      # Settings: constructor fields, then each side's methods
        o_ctor, o_rest = ours.split(END, 1)
        t_ctor, t_rest = theirs.split(END, 1)
        # each side's last method runs on into the shared closing brace after the hunk
        return o_ctor + t_ctor + END + o_rest + "  }\n" + t_rest
    if "Adjust" not in ours and ours.strip().startswith('"<p>') and theirs.strip().startswith('"<p>'):  # help text
        return ours
    if 'e.type === "settings"' in ours and 'e.type === "tap_direction"' in theirs:  # Settings.event()
        rest = theirs.split("\n", 1)[1]
        return ours + rest
    print("UNKNOWN HUNK in " + p + ":\n" + m.group(0)[:600])
    sys.exit(1)


s2 = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", fix, s, flags=re.S)
assert "<<<<<<<" not in s2
open(p, "w").write(s2)
print("resolved " + p)
