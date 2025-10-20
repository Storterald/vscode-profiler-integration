# Visual Studio Code Profiler Integration

> Not even alpha, do not use.

Profiled sessions are stored at `<extension_path>/cached/`.

Every color is **customizable** in a custom theme. Check under each [webview](#Webview)
for color mappings.

## Supported Profilers

 - `perf` *(linux)*
 - `AMD uProf` *(windows)*

# Webview

## Flame graph

![flame-graph](./resources/flame-graph.png)

Colors:
 - `profiler.integration.flamegraph.rootColor`: Color of the **'all'** node.
 - `profiler.integration.flamegraph.nodeColor`: Fixed color for **all nodes**
   except for the root one.
 - TODO: `profiler.integration.flamegraph.nodeColorMax`: Max value node color.
 - TODO: `profiler.integration.flamegraph.nodeColorMin`: Min value node color.
 - `profiler.integration.flamegraph.foreground`: Function name foreground color.

# Call tree

![call-tree](./resources/call-tree.png)

Colors:
 - TODO

# Method list

![method-list](./resources/method-list.png)

Colors:
 - TODO