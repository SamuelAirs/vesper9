# What else rides in the app's Web folder

`ios/build-web.py` runs every `.py` file here, in the order of their names, after it has
written the page. Each has one function:

```python
def build(folder):
    """Write this part's files into `folder`, beside index.html."""
```

The page is opened from a file, so it cannot fetch another file: a part that needs data at run
time writes it as a script (`something.js`) and the layer adds a `<script src>` for it when it
is wanted. Nothing here may need the network or anything outside this repository.
