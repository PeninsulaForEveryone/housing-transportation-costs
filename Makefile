PY := .venv/bin/python

.PHONY: data fetch build test sanity venv clean-data

venv: .venv/.installed
.venv/.installed: requirements.txt
	python3 -m venv .venv
	.venv/bin/pip install -q -r requirements.txt
	touch $@

fetch: venv
	$(PY) -m pipeline.fetch

build: venv
	$(PY) -m pipeline.build

data: fetch build

test: venv
	$(PY) -m pytest -q pipeline/tests
	npx vitest run

sanity: venv
	npx tsx scripts/sanity.ts

clean-data:
	rm -rf site/public/data data/sources.json
