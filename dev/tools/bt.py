# Запуск отдельных текстур из dev/blender/make_textures.py: BT=скрипт.py BOUT=папка python dev/tools/bt.py
import sys, runpy, os
g = runpy.run_path(os.path.join(os.path.dirname(__file__), '..', 'blender', 'make_textures.py'), run_name='lib')
g['render'].__globals__['OUT'] = os.environ['BOUT']
exec(open(os.environ['BT']).read(), g)
