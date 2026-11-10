"""Put the needle engine and its weights where cactus-needle looks first, fetched from a pinned Hub commit.

cactus-needle is a pure-Python wheel. On first use it downloads its native engine and the needle3 weights
from the `main` branch of Cactus-Compute/needle3 on the Hugging Face Hub, and on 2026-11-05 upstream
removed every engine wheel from that branch ("use the Cactus package", which is a different API on a
4.x runtime). From that day, every fresh build of a pinned cactus-needle failed at its warm-up with a 404
for an engine that had been there for weeks.

The Hub keeps history, so the engine a release was built and measured against is still at the commit that
was live when it shipped. This script fetches the engine and the weights from that commit, refuses
anything whose sha256 is not the one recorded here, and writes both into needle's own cache
(~/.cache/cactus-needle/v3/<engine>/), which needle reads before it would download anything. The warm-up
after it then runs with HF_HUB_OFFLINE=1, which proves nothing else is fetched.

Moving cactus-needle (`bun run deps classifier <v>`) means adding that version here: its Hub commit and
the hashes of what it serves. A version missing from PINS stops the build rather than guessing.

  python engine.py            fetch for this platform, for the installed cactus-needle
"""
import hashlib
import os
import shutil
import sys
import zipfile
from importlib.metadata import version

from huggingface_hub import hf_hub_download
from needle.agent import fetch

GENERATION = 3

# cactus-needle version -> the Hub commit that was live when it shipped, and the sha256 of each file there.
PINS = {
    "3.2.8": {
        # 2026-10-19 11:54 UTC, "Replace binaries from production build": 3.2.8 was published 12 minutes later
        "revision": "d6c7d6a2e9655505e0f8e23339356dd1705900eb",
        "sha256": {
            "needle3.cact": "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
            "python/cactus_needle-3.3.3-py3-none-manylinux2014_x86_64.whl": "b909897e11cf4da9566df6370f8a63564693fbd6edeaac0b8678b71865d4dc24",
            "python/cactus_needle-3.3.3-py3-none-manylinux2014_aarch64.whl": "cda9aa23eec3cc2cc6fea43ae5ba32b9d39a1487a198d8e2d86c1314dfe04873",
            "python/cactus_needle-3.3.3-py3-none-musllinux_1_2_x86_64.whl": "f00d79500fac006f3c7a66f6a68cf60676e7026e26d5fa8108fce5691f43620d",
            "python/cactus_needle-3.3.3-py3-none-musllinux_1_2_aarch64.whl": "a67c61a1712472ccb85ea94e7ce9817dff84c9cb6d5e0ebbac30b464b9a791db",
        },
    },
}


def die(message):
    print(f"engine.py: {message}", file=sys.stderr)
    sys.exit(1)


def checked(repo, filename, pin):
    want = pin["sha256"].get(filename)
    if not want:
        die(f"no sha256 recorded for {filename}: this platform is not one the pin covers")
    path = hf_hub_download(repo_id=repo, filename=filename, revision=pin["revision"], repo_type="model")
    with open(path, "rb") as handle:
        got = hashlib.sha256(handle.read()).hexdigest()
    if got != want:
        die(f"{filename} at {pin['revision'][:7]} has sha256 {got}, expected {want}. Refusing it.")
    return path


def main():
    installed = version("cactus-needle")
    pin = PINS.get(installed)
    if not pin:
        die(f"cactus-needle {installed} has no pinned Hub commit. Add it to PINS in packages/classifier/engine.py.")
    repo = fetch.engine_repo(GENERATION)
    dest = fetch.cache_dir(GENERATION)
    os.makedirs(dest, exist_ok=True)

    # The engine: the same wheel, member and file name needle's own fetch_library uses, from the pinned commit.
    tag = fetch._platform_tag()
    wheel = checked(repo, fetch.engine_wheel(fetch.engine_version(GENERATION), tag, GENERATION), pin)
    lib = fetch.lib_name(GENERATION, tag)
    stem, suffix = os.path.splitext(lib)
    with zipfile.ZipFile(wheel) as archive:
        data = archive.read(f"needle/{stem}{GENERATION}{suffix}")
    with open(os.path.join(dest, lib), "wb") as handle:
        handle.write(data)

    # The weights, beside it, where _base_weights_path looks before fetching.
    weights = fetch.base_weights(GENERATION)
    shutil.copyfile(checked(repo, weights, pin), os.path.join(dest, weights))
    print(f"needle {installed}: engine {fetch.engine_version(GENERATION)} ({tag}) and {weights} from {repo}@{pin['revision'][:7]} into {dest}")


if __name__ == "__main__":
    main()
