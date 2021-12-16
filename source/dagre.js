
var dagre = dagre || {};

// Dagre graph layout
// https://github.com/dagrejs/dagre
// https://github.com/dagrejs/graphlib

dagre.layout = (graph, options) => {
    options = options || {};
    // options.time = true;
    const time = (name, callback) => {
        const start = Date.now();
        const result = callback();
        const duration = Date.now() - start;
        if (options.time) {
            /* eslint-disable */
            console.log(name + ': ' + duration + 'ms');
            /* eslint-enable */
        }
        return result;
    };

    // Constructs a new graph from the input graph, which can be used for layout.
    // This process copies only whitelisted attributes from the input graph to the
    // layout graph. Thus this function serves as a good place to determine what
    // attributes can influence layout.
    const buildLayoutGraph = (graph) => {
        const g = new dagre.Graph({ compound: true });
        g.setGraph(Object.assign({}, { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: 'tb' }, graph.graph()));
        for (const v of graph.nodes().keys()) {
            const node = graph.node(v);
            g.setNode(v, {
                width: node.width || 0,
                height: node.height || 0
            });
            g.setParent(v, graph.parent(v));
        }
        for (const e of graph.edges()) {
            const edge = graph.edge(e);
            g.setEdge(e.v, e.w, {
                minlen: edge.minlen || 1,
                weight: edge.weight || 1,
                width: edge.width || 0,
                height: edge.height || 0,
                labeloffset: edge.labeloffset || 10,
                labelpos: edge.labelpos || 'r'
            });
        }
        return g;
    };

    const runLayout = (g, time) => {

        let uniqueIdCounter = 0;
        const uniqueId = (prefix) => {
            const id = ++uniqueIdCounter;
            return prefix + id;
        };

        const flat = (list) => {
            if (Array.isArray(list) && list.every((item) => !Array.isArray(item))) {
                return list;
            }
            const target = [];
            for (const item of list) {
                if (!Array.isArray(item)) {
                    target.push(item);
                    continue;
                }
                for (const entry of item) {
                    target.push(entry);
                }
            }
            return target;
        };

        // Adds a dummy node to the graph and return v.
        const addDummyNode = (g, type, node, name) => {
            let v;
            do {
                v = uniqueId(name);
            } while (g.hasNode(v));
            node.dummy = type;
            g.setNode(v, node);
            return v;
        };

        const asNonCompoundGraph = (g) => {
            const graph = new dagre.Graph({});
            graph.setGraph(g.graph());
            for (const v of g.nodes().keys()) {
                if (g.children(v).length === 0) {
                    graph.setNode(v, g.node(v));
                }
            }
            for (const e of g.edges()) {
                graph.setEdge(e.v, e.w, g.edge(e));
            }
            return graph;
        };

        const maxRank = (g) => {
            let rank = Number.NEGATIVE_INFINITY;
            for (const node of g.nodes().values()) {
                const x = node.rank;
                if (x !== undefined && x > rank) {
                    rank = x;
                }
            }
            return rank === Number.NEGATIVE_INFINITY ? undefined : rank;
        };

        // Given a DAG with each node assigned 'rank' and 'order' properties, this function will produce a matrix with the ids of each node.
        const buildLayerMatrix = (g) => {
            const rank = maxRank(g);
            const length = rank === undefined ? 0 : rank + 1;
            const layering = Array.from(new Array(length), () => []);
            for (const v of g.nodes().keys()) {
                const node = g.node(v);
                const rank = node.rank;
                if (rank !== undefined) {
                    layering[rank][node.order] = v;
                }
            }
            return layering;
        };

        // This idea comes from the Gansner paper: to account for edge labels in our layout we split each rank in half by doubling minlen and halving ranksep.
        // Then we can place labels at these mid-points between nodes.
        // We also add some minimal padding to the width to push the label for the edge away from the edge itself a bit.
        const makeSpaceForEdgeLabels = (g) => {
            const graph = g.graph();
            graph.ranksep /= 2;
            for (const e of g.edges()) {
                const edge = g.edge(e);
                edge.minlen *= 2;
                if (edge.labelpos.toLowerCase() !== 'c') {
                    if (graph.rankdir === 'TB' || graph.rankdir === 'BT') {
                        edge.width += edge.labeloffset;
                    }
                    else {
                        edge.height += edge.labeloffset;
                    }
                }
            }
        };

        /*
        * A helper that preforms a pre- or post-order traversal on the input graph
        * and returns the nodes in the order they were visited. If the graph is
        * undirected then this algorithm will navigate using neighbors. If the graph
        * is directed then this algorithm will navigate using successors.
        *
        * Order must be one of 'pre' or 'post'.
        */
        const dfs = (g, vs, order) => {
            const doDfs = (g, v, postorder, visited, navigation, acc) => {
                if (!visited.has(v)) {
                    visited.add(v);
                    if (!postorder) {
                        acc.push(v);
                    }
                    for (const w of navigation(v)) {
                        doDfs(g, w, postorder, visited, navigation, acc);
                    }
                    if (postorder) {
                        acc.push(v);
                    }
                }
            };
            if (!Array.isArray(vs)) {
                vs = [ vs ];
            }
            const navigation = (g.isDirected() ? g.successors : g.neighbors).bind(g);
            const acc = [];
            const visited = new Set();
            for (const v of vs) {
                if (!g.hasNode(v)) {
                    throw new Error('Graph does not have node: ' + v);
                }
                doDfs(g, v, order === 'post', visited, navigation, acc);
            }
            return acc;
        };
        const postorder = (g, vs) => {
            return dfs(g, vs, 'post');
        };
        const preorder = (g, vs) => {
            return dfs(g, vs, 'pre');
        };

        const removeSelfEdges = (g) => {
            for (const e of g.edges()) {
                if (e.v === e.w) {
                    const node = g.node(e.v);
                    if (!node.selfEdges) {
                        node.selfEdges = [];
                    }
                    node.selfEdges.push({ e: e, label: g.edge(e) });
                    g.removeEdge(e);
                }
            }
        };

        const acyclic_run = (g) => {
            const dfsFAS = (g) => {
                const fas = [];
                const stack = new Set();
                const visited = new Set();
                const dfs = (v) => {
                    if (!visited.has(v)) {
                        visited.add(v);
                        stack.add(v);
                        for (const e of g.outEdges(v)) {
                            if (stack.has(e.w)) {
                                fas.push(e);
                            }
                            else {
                                dfs(e.w);
                            }
                        }
                        stack.delete(v);
                    }
                };
                for (const v of g.nodes().keys()) {
                    dfs(v);
                }
                return fas;
            };
            for (const e of dfsFAS(g)) {
                const label = g.edge(e);
                g.removeEdge(e);
                label.forwardName = e.name;
                label.reversed = true;
                g.setEdge(e.w, e.v, label, uniqueId('rev'));
            }
        };
        const acyclic_undo = (g) => {
            for (const e of g.edges()) {
                const label = g.edge(e);
                if (label.reversed) {
                    g.removeEdge(e);
                    const forwardName = label.forwardName;
                    delete label.reversed;
                    delete label.forwardName;
                    g.setEdge(e.w, e.v, label, forwardName);
                }
            }
        };

        // Returns the amount of slack for the given edge. The slack is defined as the
        // difference between the length of the edge and its minimum length.
        const slack = (g, e) => {
            return g.node(e.w).rank - g.node(e.v).rank - g.edge(e).minlen;
        };

        /*
        * Assigns a rank to each node in the input graph that respects the 'minlen'
        * constraint specified on edges between nodes.
        *
        * This basic structure is derived from Gansner, et al., 'A Technique for
        * Drawing Directed Graphs.'
        *
        * Pre-conditions:
        *
        *    1. Graph must be a connected DAG
        *    2. Graph nodes must be objects
        *    3. Graph edges must have 'weight' and 'minlen' attributes
        *
        * Post-conditions:
        *
        *    1. Graph nodes will have a 'rank' attribute based on the results of the
        *       algorithm. Ranks can start at any index (including negative), we'll
        *       fix them up later.
        */
        const rank = (g) => {
            /*
            * Constructs a spanning tree with tight edges and adjusted the input node's
            * ranks to achieve this. A tight edge is one that is has a length that matches
            * its 'minlen' attribute.
            *
            * The basic structure for this function is derived from Gansner, et al., 'A
            * Technique for Drawing Directed Graphs.'
            *
            * Pre-conditions:
            *
            *    1. Graph must be a DAG.
            *    2. Graph must be connected.
            *    3. Graph must have at least one node.
            *    5. Graph nodes must have been previously assigned a 'rank' property that
            *       respects the 'minlen' property of incident edges.
            *    6. Graph edges must have a 'minlen' property.
            *
            * Post-conditions:
            *
            *    - Graph nodes will have their rank adjusted to ensure that all edges are
            *      tight.
            *
            * Returns a tree (undirected graph) that is constructed using only 'tight'
            * edges.
            */
            const feasibleTree = (g) => {
                const t = new dagre.Graph({ directed: false });
                // Choose arbitrary node from which to start our tree
                const start = g.nodes().keys().next().value;
                const size = g.nodes().size;
                t.setNode(start, {});
                // Finds the edge with the smallest slack that is incident on tree and returns it.
                const findMinSlackEdge = (t, g) => {
                    let minKey = Number.POSITIVE_INFINITY;
                    let minValue = undefined;
                    for (const e of g.edges()) {
                        if (t.hasNode(e.v) !== t.hasNode(e.w)) {
                            const key = slack(g, e);
                            if (key < minKey) {
                                minKey = key;
                                minValue = e;
                            }
                        }
                    }
                    return minValue;
                };
                // Finds a maximal tree of tight edges and returns the number of nodes in the tree.
                const tightTree = (t, g) => {
                    const stack = Array.from(t.nodes().keys()).reverse();
                    while (stack.length > 0) {
                        const v = stack.pop();
                        for (const e of g.nodeEdges(v)) {
                            const edgeV = e.v;
                            const w = (v === edgeV) ? e.w : edgeV;
                            if (!t.hasNode(w) && !slack(g, e)) {
                                t.setNode(w, {});
                                t.setEdge(v, w, {});
                                stack.push(w);
                            }
                        }
                    }
                    return t.nodes().size;
                };
                while (tightTree(t, g) < size) {
                    const edge = findMinSlackEdge(t, g);
                    const delta = t.hasNode(edge.v) ? slack(g, edge) : -slack(g, edge);
                    for (const v of t.nodes().keys()) {
                        g.node(v).rank += delta;
                    }
                }
                return t;
            };
            /*
            * Initializes ranks for the input graph using the longest path algorithm. This
            * algorithm scales well and is fast in practice, it yields rather poor
            * solutions. Nodes are pushed to the lowest layer possible, leaving the bottom
            * ranks wide and leaving edges longer than necessary. However, due to its
            * speed, this algorithm is good for getting an initial ranking that can be fed
            * into other algorithms.
            *
            * This algorithm does not normalize layers because it will be used by other
            * algorithms in most cases. If using this algorithm directly, be sure to
            * run normalize at the end.
            *
            * Pre-conditions:
            *
            *    1. Input graph is a DAG.
            *    2. Input graph node labels can be assigned properties.
            *
            * Post-conditions:
            *
            *    1. Each node will be assign an (unnormalized) 'rank' property.
            */
            const longestPath = (g) => {
                const visited = new Set();
                const dfs = (v) => {
                    const node = g.node(v);
                    if (visited.has(v)) {
                        return node.rank;
                    }
                    visited.add(v);
                    let rank = Number.MAX_SAFE_INTEGER;
                    for (const e of g.outEdges(v)) {
                        const x = dfs(e.w) - g.edge(e).minlen;
                        if (x < rank) {
                            rank = x;
                        }
                    }
                    if (rank === Number.MAX_SAFE_INTEGER) {
                        rank = 0;
                    }
                    node.rank = rank;
                    return rank;
                };
                for (const v of g.sources()) {
                    dfs(v);
                }
            };
            /*
            * The network simplex algorithm assigns ranks to each node in the input graph
            * and iteratively improves the ranking to reduce the length of edges.
            *
            * Preconditions:
            *
            *    1. The input graph must be a DAG.
            *    2. All nodes in the graph must have an object value.
            *    3. All edges in the graph must have 'minlen' and 'weight' attributes.
            *
            * Postconditions:
            *
            *    1. All nodes in the graph will have an assigned 'rank' attribute that has
            *       been optimized by the network simplex algorithm. Ranks start at 0.
            *
            *
            * A rough sketch of the algorithm is as follows:
            *
            *    1. Assign initial ranks to each node. We use the longest path algorithm,
            *       which assigns ranks to the lowest position possible. In general this
            *       leads to very wide bottom ranks and unnecessarily long edges.
            *    2. Construct a feasible tight tree. A tight tree is one such that all
            *       edges in the tree have no slack (difference between length of edge
            *       and minlen for the edge). This by itself greatly improves the assigned
            *       rankings by shorting edges.
            *    3. Iteratively find edges that have negative cut values. Generally a
            *       negative cut value indicates that the edge could be removed and a new
            *       tree edge could be added to produce a more compact graph.
            *
            * Much of the algorithms here are derived from Gansner, et al., 'A Technique
            * for Drawing Directed Graphs.' The structure of the file roughly follows the
            * structure of the overall algorithm.
            */
            const networkSimplex = (g) => {
                /*
                * Returns a new graph with only simple edges. Handles aggregation of data
                * associated with multi-edges.
                */
                const simplify = (g) => {
                    const graph = new dagre.Graph();
                    graph.setGraph(g.graph());
                    for (const v of g.nodes().keys()) {
                        graph.setNode(v, g.node(v));
                    }
                    for (const e of g.edges()) {
                        const simpleLabel = graph.edge(e) || { weight: 0, minlen: 1 };
                        const label = g.edge(e);
                        graph.setEdge(e.v, e.w, {
                            weight: simpleLabel.weight + label.weight,
                            minlen: Math.max(simpleLabel.minlen, label.minlen)
                        });
                    }
                    return graph;
                };
                const initLowLimValues = (tree, root) => {
                    root = tree.nodes().keys().next().value;
                    const dfsAssignLowLim = (tree, visited, nextLim, v, parent) => {
                        const low = nextLim;
                        const label = tree.node(v);
                        visited.add(v);
                        for (const w of tree.neighbors(v)) {
                            if (!visited.has(w)) {
                                nextLim = dfsAssignLowLim(tree, visited, nextLim, w, v);
                            }
                        }
                        label.low = low;
                        label.lim = nextLim++;
                        if (parent) {
                            label.parent = parent;
                        }
                        else {
                            // TODO should be able to remove this when we incrementally update low lim
                            delete label.parent;
                        }
                        return nextLim;
                    };
                    const visited = new Set();
                    dfsAssignLowLim(tree, visited, 1, root);
                };
                // Initializes cut values for all edges in the tree.
                const initCutValues = (t, g) => {
                    // Given the tight tree, its graph, and a child in the graph calculate and
                    // return the cut value for the edge between the child and its parent.
                    const calcCutValue = (t, g, child) => {
                        const childLab = t.node(child);
                        const parent = childLab.parent;
                        // True if the child is on the tail end of the edge in the directed graph
                        let childIsTail = true;
                        // The graph's view of the tree edge we're inspecting
                        let graphEdge = g.edge(child, parent);
                        // The accumulated cut value for the edge between this node and its parent
                        if (!graphEdge) {
                            childIsTail = false;
                            graphEdge = g.edge(parent, child);
                        }
                        let cutValue = graphEdge.weight;
                        for (const e of g.nodeEdges(child)) {
                            const isOutEdge = e.v === child;
                            const other = isOutEdge ? e.w : e.v;
                            if (other !== parent) {
                                const pointsToHead = isOutEdge === childIsTail;
                                const otherWeight = g.edge(e).weight;
                                cutValue += pointsToHead ? otherWeight : -otherWeight;
                                if (t.hasEdge(child, other)) {
                                    const otherCutValue = t.edge(child, other).cutvalue;
                                    cutValue += pointsToHead ? -otherCutValue : otherCutValue;
                                }
                            }
                        }
                        return cutValue;
                    };
                    const assignCutValue = (t, g, child) => {
                        const childLab = t.node(child);
                        const parent = childLab.parent;
                        t.edge(child, parent).cutvalue = calcCutValue(t, g, child);
                    };
                    let vs = postorder(t, Array.from(t.nodes().keys()));
                    vs = vs.slice(0, vs.length - 1);
                    for (const v of vs) {
                        assignCutValue(t, g, v);
                    }
                };
                const leaveEdge = (tree) => {
                    return Array.from(tree.edges()).find((e) => tree.edge(e).cutvalue < 0);
                };
                const enterEdge = (t, g, edge) => {
                    let v = edge.v;
                    let w = edge.w;
                    // For the rest of this function we assume that v is the tail and w is the
                    // head, so if we don't have this edge in the graph we should flip it to
                    // match the correct orientation.
                    if (!g.hasEdge(v, w)) {
                        v = edge.w;
                        w = edge.v;
                    }
                    const vLabel = t.node(v);
                    const wLabel = t.node(w);
                    let tailLabel = vLabel;
                    let flip = false;
                    // If the root is in the tail of the edge then we need to flip the logic that
                    // checks for the head and tail nodes in the candidates function below.
                    if (vLabel.lim > wLabel.lim) {
                        tailLabel = wLabel;
                        flip = true;
                    }
                    // Returns true if the specified node is descendant of the root node per the
                    // assigned low and lim attributes in the tree.
                    const isDescendant = (tree, vLabel, rootLabel) => {
                        return rootLabel.low <= vLabel.lim && vLabel.lim <= rootLabel.lim;
                    };
                    const candidates = Array.from(g.edges()).filter((edge) => flip === isDescendant(t, t.node(edge.v), tailLabel) && flip !== isDescendant(t, t.node(edge.w), tailLabel));
                    let minKey = Number.POSITIVE_INFINITY;
                    let minValue = undefined;
                    for (const edge of candidates) {
                        const key = slack(g, edge);
                        if (key < minKey) {
                            minKey = key;
                            minValue = edge;
                        }
                    }
                    return minValue;
                };
                const exchangeEdges = (t, g, e, f) => {
                    t.removeEdge(e);
                    t.setEdge(f.v, f.w, {});
                    initLowLimValues(t);
                    initCutValues(t, g);
                    const updateRanks = (t, g) => {
                        const root = Array.from(t.nodes().keys()).find((v) => !g.node(v).parent);
                        let vs = preorder(t, root);
                        vs = vs.slice(1);
                        for (const v of vs) {
                            const parent = t.node(v).parent;
                            let edge = g.edge(v, parent);
                            let flipped = false;
                            if (!edge) {
                                edge = g.edge(parent, v);
                                flipped = true;
                            }
                            g.node(v).rank = g.node(parent).rank + (flipped ? edge.minlen : -edge.minlen);
                        }
                    };
                    updateRanks(t, g);
                };
                g = simplify(g);
                longestPath(g);
                const tree = feasibleTree(g);
                initLowLimValues(tree);
                initCutValues(tree, g);
                let e;
                let f;
                while ((e = leaveEdge(tree))) {
                    f = enterEdge(tree, g, e);
                    exchangeEdges(tree, g, e, f);
                }
            };

            switch(g.graph().ranker) {
                case 'tight-tree': {
                    longestPath(g);
                    feasibleTree(g);
                    break;
                }
                case 'longest-path': {
                    longestPath(g);
                    break;
                }
                default: {
                    networkSimplex(g);
                    break;
                }
            }
        };

        // Creates temporary dummy nodes that capture the rank in which each edge's label is going to, if it has one of non-zero width and height.
        // We do this so that we can safely remove empty ranks while preserving balance for the label's position.
        const injectEdgeLabelProxies = (g) => {
            for (const e of g.edges()) {
                const edge = g.edge(e);
                if (edge.width && edge.height) {
                    const v = g.node(e.v);
                    const w = g.node(e.w);
                    const label = { rank: (w.rank - v.rank) / 2 + v.rank, e: e };
                    addDummyNode(g, 'edge-proxy', label, '_ep');
                }
            }
        };

        const removeEmptyRanks = (g) => {
            // Ranks may not start at 0, so we need to offset them
            if (g.nodes().size > 0) {
                let minRank = Number.POSITIVE_INFINITY;
                let maxRank = Number.NEGATIVE_INFINITY;
                for (const node of g.nodes().values()) {
                    if (node.rank !== undefined) {
                        if (node.rank < minRank) {
                            minRank = node.rank;
                        }
                        if (node.rank > maxRank) {
                            maxRank = node.rank;
                        }
                    }
                }
                const size = maxRank - minRank;
                if (size > 0) {
                    const layers = new Array(size);
                    for (const v of g.nodes().keys()) {
                        const node = g.node(v);
                        if (node.rank !== undefined) {
                            const rank = node.rank - minRank;
                            if (!layers[rank]) {
                                layers[rank] = [];
                            }
                            layers[rank].push(v);
                        }
                    }
                    let delta = 0;
                    const nodeRankFactor = g.graph().nodeRankFactor;
                    for (let i = 0; i < layers.length; i++) {
                        const vs = layers[i];
                        if (vs === undefined && i % nodeRankFactor !== 0) {
                            --delta;
                        }
                        else if (delta && vs) {
                            for (const v of vs) {
                                g.node(v).rank += delta;
                            }
                        }
                    }
                }
            }
        };

        /*
        * A nesting graph creates dummy nodes for the tops and bottoms of subgraphs,
        * adds appropriate edges to ensure that all cluster nodes are placed between
        * these boundries, and ensures that the graph is connected.
        *
        * In addition we ensure, through the use of the minlen property, that nodes
        * and subgraph border nodes to not end up on the same rank.
        *
        * Preconditions:
        *
        *    1. Input graph is a DAG
        *    2. Nodes in the input graph has a minlen attribute
        *
        * Postconditions:
        *
        *    1. Input graph is connected.
        *    2. Dummy nodes are added for the tops and bottoms of subgraphs.
        *    3. The minlen attribute for nodes is adjusted to ensure nodes do not
        *       get placed on the same rank as subgraph border nodes.
        *
        * The nesting graph idea comes from Sander, 'Layout of Compound Directed
        * Graphs.'
        */
        const nestingGraph_run = (g) => {
            const root = addDummyNode(g, 'root', {}, '_root');
            const treeDepths = (g) => {
                const depths = {};
                const dfs = (v, depth) => {
                    const children = g.children(v);
                    if (children && children.length > 0) {
                        for (const child of children) {
                            dfs(child, depth + 1);
                        }
                    }
                    depths[v] = depth;
                };
                for (const v of g.children()) {
                    dfs(v, 1);
                }
                return depths;
            };
            const dfs = (g, root, nodeSep, weight, height, depths, v) => {
                const children = g.children(v);
                if (!children.length) {
                    if (v !== root) {
                        g.setEdge(root, v, { weight: 0, minlen: nodeSep });
                    }
                    return;
                }
                const top = addDummyNode(g, 'border', { width: 0, height: 0 }, '_bt');
                const bottom = addDummyNode(g, 'border', { width: 0, height: 0 }, '_bb');
                const label = g.node(v);
                g.setParent(top, v);
                label.borderTop = top;
                g.setParent(bottom, v);
                label.borderBottom = bottom;
                for (const child of children) {
                    dfs(g, root, nodeSep, weight, height, depths, child);
                    const childNode = g.node(child);
                    const childTop = childNode.borderTop ? childNode.borderTop : child;
                    const childBottom = childNode.borderBottom ? childNode.borderBottom : child;
                    const thisWeight = childNode.borderTop ? weight : 2 * weight;
                    const minlen = childTop !== childBottom ? 1 : height - depths[v] + 1;
                    g.setEdge(top, childTop, { weight: thisWeight, minlen: minlen, nestingEdge: true });
                    g.setEdge(childBottom, bottom, { weight: thisWeight, minlen: minlen, nestingEdge: true });
                }
                if (!g.parent(v)) {
                    g.setEdge(root, top, { weight: 0, minlen: height + depths[v] });
                }
            };
            const depths = treeDepths(g);
            const height = Math.max(...Object.values(depths)) - 1; // Note: depths is an Object not an array
            const nodeSep = 2 * height + 1;
            g.graph().nestingRoot = root;
            // Multiply minlen by nodeSep to align nodes on non-border ranks.
            for (const e of g.edges()) {
                g.edge(e).minlen *= nodeSep;
            }
            // Calculate a weight that is sufficient to keep subgraphs vertically compact
            const sumWeights = (g) => {
                return Array.from(g.edges()).reduce((acc, e) => acc + g.edge(e).weight, 0);
            };
            const weight = sumWeights(g) + 1;
            // Create border nodes and link them up
            for (const child of g.children()) {
                dfs(g, root, nodeSep, weight, height, depths, child);
            }
            // Save the multiplier for node layers for later removal of empty border layers.
            g.graph().nodeRankFactor = nodeSep;
        };
        const nestingGraph_cleanup = (g) => {
            const graphLabel = g.graph();
            g.removeNode(graphLabel.nestingRoot);
            delete graphLabel.nestingRoot;
            for (const e of g.edges()) {
                const edge = g.edge(e);
                if (edge.nestingEdge) {
                    g.removeEdge(e);
                }
            }
        };

        // Adjusts the ranks for all nodes in the graph such that all nodes v have rank(v) >= 0 and at least one node w has rank(w) = 0.
        const normalizeRanks = (g) => {
            let min = Number.POSITIVE_INFINITY;
            for (const node of g.nodes().values()) {
                const rank = node.rank;
                if (rank !== undefined && rank < min) {
                    min = rank;
                }
            }
            for (const node of g.nodes().values()) {
                if (node.rank !== undefined) {
                    node.rank -= min;
                }
            }
        };

        const assignRankMinMax = (g) => {
            let maxRank = 0;
            for (const node of g.nodes().values()) {
                if (node.borderTop) {
                    node.minRank = g.node(node.borderTop).rank;
                    node.maxRank = g.node(node.borderBottom).rank;
                    maxRank = Math.max(maxRank, node.maxRank);
                }
            }
            g.graph().maxRank = maxRank;
        };

        // Breaks any long edges in the graph into short segments that span 1 layer each.
        // This operation is undoable with the denormalize function.
        //
        // Pre-conditions:
        //   1. The input graph is a DAG.
        //   2. Each node in the graph has a 'rank' property.
        //
        // Post-condition:
        //   1. All edges in the graph have a length of 1.
        //   2. Dummy nodes are added where edges have been split into segments.
        //   3. The graph is augmented with a 'dummyChains' attribute which contains
        //      the first dummy in each chain of dummy nodes produced.
        const normalize = (g) => {
            g.graph().dummyChains = [];
            for (const e of g.edges()) {
                let v = e.v;
                let vRank = g.node(v).rank;
                const w = e.w;
                const wRank = g.node(w).rank;
                const name = e.name;
                const edgeLabel = g.edge(e);
                const labelRank = edgeLabel.labelRank;
                if (wRank !== vRank + 1) {
                    g.removeEdge(e);
                    let dummy;
                    let attrs;
                    let first = true;
                    vRank++;
                    while (vRank < wRank) {
                        edgeLabel.points = [];
                        attrs = {
                            width: 0, height: 0,
                            edgeLabel: edgeLabel,
                            edgeObj: e,
                            rank: vRank
                        };
                        dummy = addDummyNode(g, 'edge', attrs, '_d');
                        if (vRank === labelRank) {
                            attrs.width = edgeLabel.width;
                            attrs.height = edgeLabel.height;
                            attrs.dummy = 'edge-label';
                            attrs.labelpos = edgeLabel.labelpos;
                        }
                        g.setEdge(v, dummy, { weight: edgeLabel.weight }, name);
                        if (first) {
                            g.graph().dummyChains.push(dummy);
                            first = false;
                        }
                        v = dummy;
                        vRank++;
                    }
                    g.setEdge(v, w, { weight: edgeLabel.weight }, name);
                }
            }
        };

        const denormalize = (g) => {
            for (let v of g.graph().dummyChains) {
                let node = g.node(v);
                const origLabel = node.edgeLabel;
                let w;
                const e = node.edgeObj;
                g.setEdge(e.v, e.w, origLabel, e.name);
                while (node.dummy) {
                    w = g.successors(v)[0];
                    g.removeNode(v);
                    origLabel.points.push({ x: node.x, y: node.y });
                    if (node.dummy === 'edge-label') {
                        origLabel.x = node.x;
                        origLabel.y = node.y;
                        origLabel.width = node.width;
                        origLabel.height = node.height;
                    }
                    v = w;
                    node = g.node(v);
                }
            }
        };

        const removeEdgeLabelProxies = (g) => {
            for (const v of g.nodes().keys()) {
                const node = g.node(v);
                if (node.dummy === 'edge-proxy') {
                    g.edge(node.e).labelRank = node.rank;
                    g.removeNode(v);
                }
            }
        };

        const parentDummyChains = (g) => {
            // Find a path from v to w through the lowest common ancestor (LCA). Return the full path and the LCA.
            const findPath = (g, postorderNums, v, w) => {
                const vPath = [];
                const wPath = [];
                const low = Math.min(postorderNums[v].low, postorderNums[w].low);
                const lim = Math.max(postorderNums[v].lim, postorderNums[w].lim);
                // Traverse up from v to find the LCA
                let parent = v;
                do {
                    parent = g.parent(parent);
                    vPath.push(parent);
                }
                while (parent && (postorderNums[parent].low > low || lim > postorderNums[parent].lim));
                const lca = parent;
                // Traverse from w to LCA
                parent = w;
                while ((parent = g.parent(parent)) !== lca) {
                    wPath.push(parent);
                }
                return { path: vPath.concat(wPath.reverse()), lca: lca };
            };
            const postorder = (g) => {
                const result = {};
                let lim = 0;
                const dfs = (v) => {
                    const low = lim;
                    for (const u of g.children(v)) {
                        dfs(u);
                    }
                    result[v] = { low: low, lim: lim++ };
                };
                for (const v of g.children()) {
                    dfs(v);
                }
                return result;
            };
            const postorderNums = postorder(g);
            for (let v of g.graph().dummyChains || []) {
                let node = g.node(v);
                const edgeObj = node.edgeObj;
                const pathData = findPath(g, postorderNums, edgeObj.v, edgeObj.w);
                const path = pathData.path;
                const lca = pathData.lca;
                let pathIdx = 0;
                let pathV = path[pathIdx];
                let ascending = true;
                while (v !== edgeObj.w) {
                    node = g.node(v);
                    if (ascending) {
                        while ((pathV = path[pathIdx]) !== lca && g.node(pathV).maxRank < node.rank) {
                            pathIdx++;
                        }
                        if (pathV === lca) {
                            ascending = false;
                        }
                    }
                    if (!ascending) {
                        while (pathIdx < path.length - 1 && g.node(pathV = path[pathIdx + 1]).minRank <= node.rank) {
                            pathIdx++;
                        }
                        pathV = path[pathIdx];
                    }
                    g.setParent(v, pathV);
                    v = g.successors(v)[0];
                }
            }
        };

        const addBorderSegments = (g) => {
            const addBorderNode = (g, prop, prefix, sg, sgNode, rank) => {
                const label = { width: 0, height: 0, rank: rank, borderType: prop };
                const prev = sgNode[prop][rank - 1];
                const curr = addDummyNode(g, 'border', label, prefix);
                sgNode[prop][rank] = curr;
                g.setParent(curr, sg);
                if (prev) {
                    g.setEdge(prev, curr, { weight: 1 });
                }
            };
            const dfs = (v) => {
                const children = g.children(v);
                const node = g.node(v);
                if (children.length) {
                    for (const v of children) {
                        dfs(v);
                    }
                }
                if ('minRank' in node) {
                    node.borderLeft = [];
                    node.borderRight = [];
                    for (let rank = node.minRank, maxRank = node.maxRank + 1; rank < maxRank; ++rank) {
                        addBorderNode(g, 'borderLeft', '_bl', v, node, rank);
                        addBorderNode(g, 'borderRight', '_br', v, node, rank);
                    }
                }
            };
            for (const v of g.children()) {
                dfs(v);
            }
        };

        /*
        * Applies heuristics to minimize edge crossings in the graph and sets the best
        * order solution as an order attribute on each node.
        *
        * Pre-conditions:
        *
        *    1. Graph must be DAG
        *    2. Graph nodes must be objects with a 'rank' attribute
        *    3. Graph edges must have the 'weight' attribute
        *
        * Post-conditions:
        *
        *    1. Graph nodes will have an 'order' attribute based on the results of the algorithm.
        */
        const order = (g) => {
            const sortSubgraph = (g, v, cg, biasRight) => {
                /*
                * Given a list of entries of the form {v, barycenter, weight} and a
                * constraint graph this function will resolve any conflicts between the
                * constraint graph and the barycenters for the entries. If the barycenters for
                * an entry would violate a constraint in the constraint graph then we coalesce
                * the nodes in the conflict into a new node that respects the contraint and
                * aggregates barycenter and weight information.
                *
                * This implementation is based on the description in Forster, 'A Fast and Simple Hueristic for Constrained Two-Level Crossing Reduction,' thought it differs in some specific details.
                *
                * Pre-conditions:
                *
                *    1. Each entry has the form {v, barycenter, weight}, or if the node has
                *       no barycenter, then {v}.
                *
                * Returns:
                *
                *    A new list of entries of the form {vs, i, barycenter, weight}. The list
                *    `vs` may either be a singleton or it may be an aggregation of nodes
                *    ordered such that they do not violate constraints from the constraint
                *    graph. The property `i` is the lowest original index of any of the
                *    elements in `vs`.
                */
                const resolveConflicts = (entries, cg) => {
                    const mergeEntries = (target, source) => {
                        let sum = 0;
                        let weight = 0;
                        if (target.weight) {
                            sum += target.barycenter * target.weight;
                            weight += target.weight;
                        }
                        if (source.weight) {
                            sum += source.barycenter * source.weight;
                            weight += source.weight;
                        }
                        target.vs = source.vs.concat(target.vs);
                        target.barycenter = sum / weight;
                        target.weight = weight;
                        target.i = Math.min(source.i, target.i);
                        source.merged = true;
                    };
                    const mappedEntries = {};
                    entries.forEach(function(entry, i) {
                        const tmp = mappedEntries[entry.v] = {
                            indegree: 0,
                            'in': [],
                            out: [],
                            vs: [entry.v],
                            i: i
                        };
                        if (entry.barycenter !== undefined) {
                            tmp.barycenter = entry.barycenter;
                            tmp.weight = entry.weight;
                        }
                    });
                    for (const e of cg.edges()) {
                        const entryV = mappedEntries[e.v];
                        const entryW = mappedEntries[e.w];
                        if (entryV !== undefined && entryW !== undefined) {
                            entryW.indegree++;
                            entryV.out.push(mappedEntries[e.w]);
                        }
                    }
                    const sourceSet = Object.values(mappedEntries).filter((entry) => !entry.indegree);
                    const results = [];
                    function handleIn(vEntry) {
                        return function(uEntry) {
                            if (uEntry.merged) {
                                return;
                            }
                            if (uEntry.barycenter === undefined || vEntry.barycenter === undefined || uEntry.barycenter >= vEntry.barycenter) {
                                mergeEntries(vEntry, uEntry);
                            }
                        };
                    }
                    function handleOut(vEntry) {
                        return function(wEntry) {
                            wEntry.in.push(vEntry);
                            if (--wEntry.indegree === 0) {
                                sourceSet.push(wEntry);
                            }
                        };
                    }
                    while (sourceSet.length) {
                        const entry = sourceSet.pop();
                        results.push(entry);
                        entry.in.reverse().forEach(handleIn(entry));
                        entry.out.forEach(handleOut(entry));
                    }
                    const pick = (obj, attrs) => {
                        const value = {};
                        for (const key of attrs) {
                            if (obj[key] !== undefined) {
                                value[key] = obj[key];
                            }
                        }
                        return value;
                    };
                    return Object.values(results).filter((entry) => !entry.merged).map((entry) => pick(entry, ['vs', 'i', 'barycenter', 'weight']));
                };
                let movable = g.children(v);
                const node = g.node(v);
                const bl = node ? node.borderLeft : undefined;
                const br = node ? node.borderRight: undefined;
                const subgraphs = {};
                if (bl) {
                    movable = movable.filter((w) => w !== bl && w !== br);
                }
                const barycenter = (g, movable) => {
                    return (movable || []).map((v) => {
                        const inV = g.inEdges(v);
                        if (!inV.length) {
                            return { v: v };
                        }
                        else {
                            const result = inV.reduce((acc, e) => {
                                const edge = g.edge(e);
                                const nodeU = g.node(e.v);
                                return {
                                    sum: acc.sum + (edge.weight * nodeU.order),
                                    weight: acc.weight + edge.weight
                                };
                            }, { sum: 0, weight: 0 });
                            return {
                                v: v,
                                barycenter: result.sum / result.weight,
                                weight: result.weight
                            };
                        }
                    });
                };
                const mergeBarycenters = (target, other) => {
                    if (target.barycenter !== undefined) {
                        target.barycenter = (target.barycenter * target.weight + other.barycenter * other.weight) / (target.weight + other.weight);
                        target.weight += other.weight;
                    }
                    else {
                        target.barycenter = other.barycenter;
                        target.weight = other.weight;
                    }
                };
                const barycenters = barycenter(g, movable);
                for (const entry of barycenters) {
                    if (g.children(entry.v).length) {
                        const subgraphResult = sortSubgraph(g, entry.v, cg, biasRight);
                        subgraphs[entry.v] = subgraphResult;
                        if ('barycenter' in subgraphResult) {
                            mergeBarycenters(entry, subgraphResult);
                        }
                    }
                }
                const entries = resolveConflicts(barycenters, cg);
                // expand subgraphs
                for (const entry of entries) {
                    entry.vs = flat(entry.vs.map((v) => subgraphs[v] ? subgraphs[v].vs : v));
                }
                const sort = (entries, biasRight) => {
                    const consumeUnsortable = (vs, unsortable, index) => {
                        let last;
                        while (unsortable.length && (last = unsortable[unsortable.length - 1]).i <= index) {
                            unsortable.pop();
                            vs.push(last.vs);
                            index++;
                        }
                        return index;
                    };
                    const compareWithBias = (bias) => {
                        return function(entryV, entryW) {
                            if (entryV.barycenter < entryW.barycenter) {
                                return -1;
                            }
                            else if (entryV.barycenter > entryW.barycenter) {
                                return 1;
                            }
                            return !bias ? entryV.i - entryW.i : entryW.i - entryV.i;
                        };
                    };
                    // partition
                    const parts = { lhs: [], rhs: [] };
                    for (const value of entries) {
                        if ('barycenter' in value) {
                            parts.lhs.push(value);
                        }
                        else {
                            parts.rhs.push(value);
                        }
                    }
                    const sortable = parts.lhs;
                    const unsortable = parts.rhs.sort((a, b) => -a.i + b.i);
                    const vs = [];
                    let sum = 0;
                    let weight = 0;
                    let vsIndex = 0;
                    sortable.sort(compareWithBias(!!biasRight));
                    vsIndex = consumeUnsortable(vs, unsortable, vsIndex);
                    for (const entry of sortable) {
                        vsIndex += entry.vs.length;
                        vs.push(entry.vs);
                        sum += entry.barycenter * entry.weight;
                        weight += entry.weight;
                        vsIndex = consumeUnsortable(vs, unsortable, vsIndex);
                    }
                    const result = { vs: flat(vs) };
                    if (weight) {
                        result.barycenter = sum / weight;
                        result.weight = weight;
                    }
                    return result;
                };
                const result = sort(entries, biasRight);
                if (bl) {
                    result.vs = flat([bl, result.vs, br]);
                    if (g.predecessors(bl).length) {
                        const blPred = g.node(g.predecessors(bl)[0]);
                        const brPred = g.node(g.predecessors(br)[0]);
                        if (!('barycenter' in result)) {
                            result.barycenter = 0;
                            result.weight = 0;
                        }
                        result.barycenter = (result.barycenter * result.weight + blPred.order + brPred.order) / (result.weight + 2);
                        result.weight += 2;
                    }
                }
                return result;
            };
            const addSubgraphConstraints = (g, cg, vs) => {
                const prev = {};
                let rootPrev;
                for (const v of vs) {
                    let child = g.parent(v);
                    let parent;
                    let prevChild;
                    while (child) {
                        parent = g.parent(child);
                        if (parent) {
                            prevChild = prev[parent];
                            prev[parent] = child;
                        }
                        else {
                            prevChild = rootPrev;
                            rootPrev = child;
                        }
                        if (prevChild && prevChild !== child) {
                            cg.setEdge(prevChild, child, null);
                            return;
                        }
                        child = parent;
                    }
                }
            };
            const sweepLayerGraphs = (layerGraphs, biasRight) => {
                const cg = new dagre.Graph();
                for (const lg of layerGraphs) {
                    const root = lg.graph().root;
                    const sorted = sortSubgraph(lg, root, cg, biasRight);
                    const vs = sorted.vs;
                    const length = vs.length;
                    for (let i = 0; i < length; i++) {
                        lg.node(vs[i]).order = i;
                    }
                    addSubgraphConstraints(lg, cg, sorted.vs);
                }
            };
            /*
            * A function that takes a layering (an array of layers, each with an array of
            * ordererd nodes) and a graph and returns a weighted crossing count.
            *
            * Pre-conditions:
            *
            *    1. Input graph must be simple (not a multigraph), directed, and include
            *       only simple edges.
            *    2. Edges in the input graph must have assigned weights.
            *
            * Post-conditions:
            *
            *    1. The graph and layering matrix are left unchanged.
            *
            * This algorithm is derived from Barth, et al., 'Bilayer Cross Counting.'
            */
            const crossCount = (g, layering) => {
                let count = 0;
                for (let i = 1; i < layering.length; i++) {
                    const northLayer = layering[i - 1];
                    const southLayer = layering[i];
                    // Sort all of the edges between the north and south layers by their position
                    // in the north layer and then the south. Map these edges to the position of
                    // their head in the south layer.
                    const southPos = {};
                    for (let i = 0; i < southLayer.length; i++) {
                        southPos[southLayer[i]] = i;
                    }
                    const southEntries = [];
                    for (const v of northLayer) {
                        const edges = g.outEdges(v);
                        const entries = [];
                        for (const e of edges) {
                            entries.push({
                                pos: southPos[e.w],
                                weight: g.edge(e).weight
                            });
                        }
                        entries.sort((a, b) => a.pos - b.pos);
                        for (const entry of entries) {
                            southEntries.push(entry);
                        }
                    }
                    // Build the accumulator tree
                    let firstIndex = 1;
                    while (firstIndex < southLayer.length) {
                        firstIndex <<= 1;
                    }
                    const treeSize = 2 * firstIndex - 1;
                    firstIndex -= 1;
                    const tree = Array.from(new Array(treeSize), () => 0);
                    // Calculate the weighted crossings
                    for (const entry of southEntries) {
                        let index = entry.pos + firstIndex;
                        tree[index] += entry.weight;
                        let weightSum = 0;
                        while (index > 0) {
                            if (index % 2) {
                                weightSum += tree[index + 1];
                            }
                            index = (index - 1) >> 1;
                            tree[index] += entry.weight;
                        }
                        count += entry.weight * weightSum;
                    }
                }
                return count;
            };
            /*
            * Assigns an initial order value for each node by performing a DFS search
            * starting from nodes in the first rank. Nodes are assigned an order in their
            * rank as they are first visited.
            *
            * This approach comes from Gansner, et al., 'A Technique for Drawing Directed
            * Graphs.'
            *
            * Returns a layering matrix with an array per layer and each layer sorted by
            * the order of its nodes.
            */
            const initOrder = (g) => {
                const visited = new Set();
                const nodes = Array.from(g.nodes().keys()).filter((v) => !g.children(v).length);
                let maxRank = undefined;
                for (const v of nodes) {
                    if (!g.children(v).length > 0) {
                        const rank = g.node(v).rank;
                        if (maxRank === undefined || (rank !== undefined && rank > maxRank)) {
                            maxRank = rank;
                        }
                    }
                }
                if (maxRank !== undefined) {
                    const layers = Array.from(new Array(maxRank + 1), () => []);
                    for (const v of nodes.map((v) => [ g.node(v).rank, v ]).sort((a, b) => a[0] - b[0]).map((item) => item[1])) {
                        const queue = [ v ];
                        while (queue.length > 0) {
                            const v = queue.shift();
                            if (!visited.has(v)) {
                                visited.add(v);
                                const rank = g.node(v).rank;
                                layers[rank].push(v);
                                queue.push(...g.successors(v));
                            }
                        }
                    }
                    return layers;
                }
                return [];
            };
            // Constructs a graph that can be used to sort a layer of nodes. The graph will
            // contain all base and subgraph nodes from the request layer in their original
            // hierarchy and any edges that are incident on these nodes and are of the type
            // requested by the 'relationship' parameter.
            //
            // Nodes from the requested rank that do not have parents are assigned a root
            // node in the output graph, which is set in the root graph attribute. This
            // makes it easy to walk the hierarchy of movable nodes during ordering.
            //
            // Pre-conditions:
            //    1. Input graph is a DAG
            //    2. Base nodes in the input graph have a rank attribute
            //    3. Subgraph nodes in the input graph has minRank and maxRank attributes
            //    4. Edges have an assigned weight
            //
            // Post-conditions:
            //    1. Output graph has all nodes in the movable rank with preserved
            //       hierarchy.
            //    2. Root nodes in the movable layer are made children of the node
            //       indicated by the root attribute of the graph.
            //    3. Non-movable nodes incident on movable nodes, selected by the
            //       relationship parameter, are included in the graph (without hierarchy).
            //    4. Edges incident on movable nodes, selected by the relationship
            //       parameter, are added to the output graph.
            //    5. The weights for copied edges are aggregated as need, since the output
            //       graph is not a multi-graph.
            const buildLayerGraph = (g, rank, relationship) => {
                let root;
                while (g.hasNode((root = uniqueId('_root'))));
                const graph = new dagre.Graph({ compound: true });
                graph.setGraph({ root: root });
                graph.setDefaultNodeLabel((v) => g.node(v));
                for (const v of g.nodes().keys()) {
                    const node = g.node(v);
                    if (node.rank === rank || node.minRank <= rank && rank <= node.maxRank) {
                        graph.setNode(v);
                        const parent = g.parent(v);
                        graph.setParent(v, parent || root);
                        // This assumes we have only short edges!
                        if (relationship) {
                            for (const e of g.inEdges(v)) {
                                graph.setEdge(e.v, v, { weight: g.edge(e).weight });
                            }
                        }
                        else {
                            for (const e of g.outEdges(v)) {
                                graph.setEdge(e.w, v, { weight: g.edge(e).weight });
                            }
                        }
                        if ('minRank' in node) {
                            graph.setNode(v, {
                                borderLeft: node.borderLeft[rank],
                                borderRight: node.borderRight[rank]
                            });
                        }
                    }
                }
                return graph;
            };
            let layering = initOrder(g);
            const assignOrder = (g, layering) => {
                for (const layer of layering) {
                    for (let i = 0; i < layer.length; i++) {
                        g.node(layer[i]).order = i;
                    }
                }
            };
            assignOrder(g, layering);

            const rank = maxRank(g);
            const downLayerGraphs = new Array(rank !== undefined ? rank : 0);
            const upLayerGraphs = new Array(rank !== undefined ? rank : 0);
            for (let i = 0; i < rank; i++) {
                downLayerGraphs[i] = buildLayerGraph(g, i + 1, true);
                upLayerGraphs[i] = buildLayerGraph(g, rank - i - 1, false);
            }
            let bestCC = Number.POSITIVE_INFINITY;
            let best;
            for (let i = 0, lastBest = 0; lastBest < 4; ++i, ++lastBest) {
                sweepLayerGraphs(i % 2 ? downLayerGraphs : upLayerGraphs, i % 4 >= 2);
                layering = buildLayerMatrix(g);
                const cc = crossCount(g, layering);
                if (cc < bestCC) {
                    lastBest = 0;
                    const length = layering.length;
                    best = new Array(length);
                    for (let j = 0; j < length; j++) {
                        best[j] = layering[j].slice();
                    }
                    bestCC = cc;
                }
            }
            assignOrder(g, best);
        };

        const insertSelfEdges = (g) => {
            const layers = buildLayerMatrix(g);
            for (const layer of layers) {
                let orderShift = 0;
                layer.forEach(function(v, i) {
                    const node = g.node(v);
                    node.order = i + orderShift;
                    if (node.selfEdges) {
                        for (const selfEdge of node.selfEdges) {
                            addDummyNode(g, 'selfedge', {
                                width: selfEdge.label.width,
                                height: selfEdge.label.height,
                                rank: node.rank,
                                order: i + (++orderShift),
                                e: selfEdge.e,
                                label: selfEdge.label
                            }, '_se');
                        }
                        delete node.selfEdges;
                    }
                });
            }
        };

        const coordinateSystem_adjust = (g) => {
            const rankDir = g.graph().rankdir.toLowerCase();
            if (rankDir === 'lr' || rankDir === 'rl') {
                coordinateSystem_swapWidthHeight(g);
            }
        };

        const coordinateSystem_undo = (g) => {
            const swapXY = (g) => {
                const swapXYOne = (attrs) => {
                    const x = attrs.x;
                    attrs.x = attrs.y;
                    attrs.y = x;
                };
                for (const node of g.nodes().values()) {
                    swapXYOne(node);
                }
                for (const e of g.edges()) {
                    const edge = g.edge(e);
                    for (const e of edge.points) {
                        swapXYOne(e);
                    }
                    if (edge.x !== undefined) {
                        swapXYOne(edge);
                    }
                }
            };
            const rankDir = g.graph().rankdir.toLowerCase();
            if (rankDir === 'bt' || rankDir === 'rl') {
                for (const node of g.nodes().values()) {
                    node.y = -node.y;
                }
                for (const e of g.edges()) {
                    const edge = g.edge(e);
                    for (const attr of edge.points) {
                        attr.y = -attr.y;
                    }
                    if ('y' in edge) {
                        edge.y = -edge.y;
                    }
                }
            }
            if (rankDir === 'lr' || rankDir === 'rl') {
                swapXY(g);
                coordinateSystem_swapWidthHeight(g);
            }
        };
        const coordinateSystem_swapWidthHeight = (g) => {
            for (const node of g.nodes().values()) {
                const w = node.width;
                node.width = node.height;
                node.height = w;
            }
            for (const e of g.edges()) {
                const edge = g.edge(e);
                const w = edge.width;
                edge.width = edge.height;
                edge.height = w;
            }
        };

        const position = (g) => {
            // Coordinate assignment based on Brandes and Köpf, 'Fast and Simple Horizontal Coordinate Assignment.'
            const positionX = (g) => {
                const addConflict = (conflicts, v, w) => {
                    if (v > w) {
                        const tmp = v;
                        v = w;
                        w = tmp;
                    }
                    let conflictsV = conflicts[v];
                    if (!conflictsV) {
                        conflicts[v] = conflictsV = {};
                    }
                    conflictsV[w] = true;
                };
                const hasConflict = (conflicts, v, w) => {
                    if (v > w) {
                        const tmp = v;
                        v = w;
                        w = tmp;
                    }
                    return conflicts[v] && w in conflicts[v];
                };
                /*
                * Try to align nodes into vertical 'blocks' where possible. This algorithm
                * attempts to align a node with one of its median neighbors. If the edge
                * connecting a neighbor is a type-1 conflict then we ignore that possibility.
                * If a previous node has already formed a block with a node after the node
                * we're trying to form a block with, we also ignore that possibility - our
                * blocks would be split in that scenario.
                */
                const verticalAlignment = (g, layering, conflicts, neighborFn) => {
                    const root = {};
                    const align = {};
                    const pos = {};
                    // We cache the position here based on the layering because the graph and layering may be out of sync.
                    // The layering matrix is manipulated to generate different extreme alignments.
                    for (const layer of layering) {
                        let order = 0;
                        for (const v of layer) {
                            root[v] = v;
                            align[v] = v;
                            pos[v] = order;
                            order++;
                        }
                    }
                    for (const layer of layering) {
                        let prevIdx = -1;
                        for (const v of layer) {
                            let ws = neighborFn(v);
                            if (ws.length > 0) {
                                ws = ws.sort((a, b) => pos[a] - pos[b]);
                                const mp = (ws.length - 1) / 2.0;
                                const il = Math.ceil(mp);
                                for (let i = Math.floor(mp); i <= il; i++) {
                                    const w = ws[i];
                                    if (align[v] === v && prevIdx < pos[w] && !hasConflict(conflicts, v, w)) {
                                        align[w] = v;
                                        align[v] = root[v] = root[w];
                                        prevIdx = pos[w];
                                    }
                                }
                            }
                        }
                    }
                    return { root: root, align: align };
                };
                const horizontalCompaction = (g, layering, root, align, reverseSep) => {
                    // This portion of the algorithm differs from BK due to a number of problems.
                    // Instead of their algorithm we construct a new block graph and do two sweeps.
                    // The first sweep places blocks with the smallest possible coordinates.
                    // The second sweep removes unused space by moving blocks to the greatest coordinates without violating separation.
                    const xs = {};
                    const blockG = buildBlockGraph(g, layering, root, reverseSep);
                    const borderType = reverseSep ? 'borderLeft' : 'borderRight';
                    const iterate = (setXsFunc, nextNodesFunc) => {
                        let stack = Array.from(blockG.nodes().keys());
                        let elem = stack.pop();
                        const visited = new Set();
                        while (elem) {
                            if (visited.has(elem)) {
                                setXsFunc(elem);
                            }
                            else {
                                visited.add(elem);
                                stack.push(elem);
                                stack = stack.concat(nextNodesFunc(elem));
                            }
                            if (stack.length === 0) {
                                break;
                            }
                            elem = stack.pop();
                        }
                    };
                    // First pass, assign smallest coordinates
                    const pass1 = (elem) => {
                        let max = 0;
                        for (const e of blockG.inEdges(elem)) {
                            max = Math.max(max, xs[e.v] + blockG.edge(e));
                        }
                        xs[elem] = max;
                    };
                    // Second pass, assign greatest coordinates
                    const pass2 = (elem) => {
                        const edges = blockG.outEdges(elem);
                        let min = Number.POSITIVE_INFINITY;
                        for (const e of edges) {
                            min = Math.min(min, xs[e.w] - blockG.edge(e));
                        }
                        const node = g.node(elem);
                        if (min !== Number.POSITIVE_INFINITY && node.borderType !== borderType) {
                            xs[elem] = Math.max(xs[elem], min);
                        }
                    };
                    iterate(pass1, blockG.predecessors.bind(blockG));
                    iterate(pass2, blockG.successors.bind(blockG));
                    // Assign x coordinates to all nodes
                    for (const v of Object.values(align)) {
                        xs[v] = xs[root[v]];
                    }
                    return xs;
                };
                const buildBlockGraph = (g, layering, root, reverseSep) => {
                    const sep = (nodeSep, edgeSep, reverseSep) => {
                        return function(g, v, w) {
                            const vLabel = g.node(v);
                            const wLabel = g.node(w);
                            let sum = 0;
                            let delta;
                            sum += vLabel.width / 2;
                            if ('labelpos' in vLabel) {
                                switch (vLabel.labelpos.toLowerCase()) {
                                    case 'l': delta = -vLabel.width / 2; break;
                                    case 'r': delta = vLabel.width / 2; break;
                                }
                            }
                            if (delta) {
                                sum += reverseSep ? delta : -delta;
                            }
                            delta = 0;
                            sum += (vLabel.dummy ? edgeSep : nodeSep) / 2;
                            sum += (wLabel.dummy ? edgeSep : nodeSep) / 2;
                            sum += wLabel.width / 2;
                            if ('labelpos' in wLabel) {
                                switch (wLabel.labelpos.toLowerCase()) {
                                    case 'l': delta = wLabel.width / 2; break;
                                    case 'r': delta = -wLabel.width / 2; break;
                                }
                            }
                            if (delta) {
                                sum += reverseSep ? delta : -delta;
                            }
                            delta = 0;
                            return sum;
                        };
                    };
                    const blockGraph = new dagre.Graph();
                    const graphLabel = g.graph();
                    const sepFn = sep(graphLabel.nodesep, graphLabel.edgesep, reverseSep);
                    for (const layer of layering) {
                        let u;
                        for (const v of layer) {
                            const vRoot = root[v];
                            blockGraph.setNode(vRoot, {});
                            if (u) {
                                const uRoot = root[u];
                                const prevMax = blockGraph.edge(uRoot, vRoot);
                                blockGraph.setEdge(uRoot, vRoot, Math.max(sepFn(g, v, u), prevMax || 0));
                            }
                            u = v;
                        }
                    }
                    return blockGraph;
                };

                // Returns the alignment that has the smallest width of the given alignments.
                const findSmallestWidthAlignment = (g, xss) => {
                    let minKey = Number.POSITIVE_INFINITY;
                    let minValue = undefined;
                    for (const xs of Object.values(xss)) {
                        let max = Number.NEGATIVE_INFINITY;
                        let min = Number.POSITIVE_INFINITY;
                        for (const entry of Object.entries(xs)) {
                            const v = entry[0];
                            const x = entry[1];
                            const halfWidth = g.node(v).width / 2.0;
                            max = Math.max(x + halfWidth, max);
                            min = Math.min(x - halfWidth, min);
                        }
                        const key = max - min;
                        if (key < minKey) {
                            minKey = key;
                            minValue = xs;
                        }
                    }
                    return minValue;
                };
                const balance = (xss, align) => {
                    const value = {};
                    if (align) {
                        const xs = xss[align.toLowerCase()];
                        for (const v of Object.keys(xss.ul)) {
                            value[v] = xs[v];
                        }
                    }
                    else {
                        for (const v of Object.keys(xss.ul)) {
                            const xs = [ xss.ul[v], xss.ur[v], xss.dl[v], xss.dr[v] ].sort((a, b) => a - b);
                            value[v] = (xs[1] + xs[2]) / 2.0;
                        }
                    }
                    return value;
                };

                // Marks all edges in the graph with a type-1 conflict with the 'type1Conflict' property.
                // A type-1 conflict is one where a non-inner segment crosses an inner segment.
                // An inner segment is an edge with both incident nodes marked with the 'dummy' property.
                //
                // This algorithm scans layer by layer, starting with the second, for type-1
                // conflicts between the current layer and the previous layer. For each layer
                // it scans the nodes from left to right until it reaches one that is incident
                // on an inner segment. It then scans predecessors to determine if they have
                // edges that cross that inner segment. At the end a final scan is done for all
                // nodes on the current rank to see if they cross the last visited inner segment.
                //
                // This algorithm (safely) assumes that a dummy node will only be incident on a
                // single node in the layers being scanned.
                const findType1Conflicts = (g, layering) => {
                    const conflicts = {};
                    if (layering.length > 0) {
                        let prev = layering[0];
                        for (let i = 1; i < layering.length; i++) {
                            const layer = layering[i];
                            // last visited node in the previous layer that is incident on an inner segment.
                            let k0 = 0;
                            // Tracks the last node in this layer scanned for crossings with a type-1 segment.
                            let scanPos = 0;
                            const prevLayerLength = prev.length;
                            const lastNode = layer[layer.length - 1];
                            for (let i = 0; i < layer.length; i++) {
                                const v = layer[i];
                                const w = g.node(v).dummy ? g.predecessors(v).find((u) => g.node(u).dummy) : null;
                                if (w || v === lastNode) {
                                    const k1 = w ? g.node(w).order : prevLayerLength;
                                    for (const scanNode of layer.slice(scanPos, i + 1)) {
                                    // for (const scanNode of layer.slice(scanPos, scanPos + 1)) {
                                        for (const u of g.predecessors(scanNode)) {
                                            const uLabel = g.node(u);
                                            const uPos = uLabel.order;
                                            if ((uPos < k0 || k1 < uPos) && !(uLabel.dummy && g.node(scanNode).dummy)) {
                                                addConflict(conflicts, u, scanNode);
                                            }
                                        }
                                    }
                                    // scanPos += 1;
                                    scanPos = i + 1;
                                    k0 = k1;
                                }
                            }
                            prev = layer;
                        }
                    }
                    return conflicts;
                };

                const findType2Conflicts = (g, layering) => {
                    const conflicts = {};
                    const scan = (south, southPos, southEnd, prevNorthBorder, nextNorthBorder) => {
                        let v;
                        for (let i = southPos; i < southEnd; i++) {
                            v = south[i];
                            if (g.node(v).dummy) {
                                for (const u of g.predecessors(v)) {
                                    const uNode = g.node(u);
                                    if (uNode.dummy && (uNode.order < prevNorthBorder || uNode.order > nextNorthBorder)) {
                                        addConflict(conflicts, u, v);
                                    }
                                }
                            }
                        }
                    };
                    if (layering.length > 0) {
                        let north = layering[0];
                        for (let i = 1; i < layering.length; i++) {
                            const south = layering[i];
                            let prevNorthPos = -1;
                            let nextNorthPos;
                            let southPos = 0;
                            south.forEach(function(v, southLookahead) {
                                if (g.node(v).dummy === 'border') {
                                    const predecessors = g.predecessors(v);
                                    if (predecessors.length) {
                                        nextNorthPos = g.node(predecessors[0]).order;
                                        scan(south, southPos, southLookahead, prevNorthPos, nextNorthPos);
                                        southPos = southLookahead;
                                        prevNorthPos = nextNorthPos;
                                    }
                                }
                                scan(south, southPos, south.length, nextNorthPos, north.length);
                            });
                            north = south;
                        }
                    }
                    return conflicts;
                };
                // Align the coordinates of each of the layout alignments such that
                // left-biased alignments have their minimum coordinate at the same point as
                // the minimum coordinate of the smallest width alignment and right-biased
                // alignments have their maximum coordinate at the same point as the maximum
                // coordinate of the smallest width alignment.
                const alignCoordinates = (xss, alignTo) => {
                    const range = (values) => {
                        let min = Number.POSITIVE_INFINITY;
                        let max = Number.NEGATIVE_INFINITY;
                        for (const value of values) {
                            if (value < min) {
                                min = value;
                            }
                            if (value > max) {
                                max = value;
                            }
                        }
                        return [ min, max ];
                    };
                    const alignToRange = range(Object.values(alignTo));
                    for (const vert of ['u', 'd']) {
                        for (const horiz of ['l', 'r']) {
                            const alignment = vert + horiz;
                            const xs = xss[alignment];
                            let delta;
                            if (xs !== alignTo) {
                                const vsValsRange = range(Object.values(xs));
                                delta = horiz === 'l' ? alignToRange[0] - vsValsRange[0] : alignToRange[1] - vsValsRange[1];
                                if (delta) {
                                    const list = {};
                                    for (const key of Object.keys(xs)) {
                                        list[key] = xs[key] + delta;
                                    }
                                    xss[alignment] = list;
                                }
                            }
                        }
                    }
                };

                const layering = buildLayerMatrix(g);
                const conflicts = Object.assign(findType1Conflicts(g, layering), findType2Conflicts(g, layering));
                const xss = {};
                for (const vert of ['u', 'd']) {
                    let adjustedLayering = vert === 'u' ? layering : Object.values(layering).reverse();
                    for (const horiz of ['l', 'r']) {
                        if (horiz === 'r') {
                            adjustedLayering = adjustedLayering.map((inner) => Object.values(inner).reverse());
                        }
                        const neighborFn = (vert === 'u' ? g.predecessors : g.successors).bind(g);
                        const align = verticalAlignment(g, adjustedLayering, conflicts, neighborFn);
                        const xs = horizontalCompaction(g, adjustedLayering, align.root, align.align, horiz === 'r');
                        if (horiz === 'r') {
                            for (const entry of Object.entries(xs)) {
                                xs[entry[0]] = -entry[1];
                            }
                        }
                        xss[vert + horiz] = xs;
                    }
                }
                const smallestWidth = findSmallestWidthAlignment(g, xss);
                alignCoordinates(xss, smallestWidth);
                return balance(xss, g.graph().align);
            };

            g = asNonCompoundGraph(g);
            const layering = buildLayerMatrix(g);
            const rankSep = g.graph().ranksep;
            let prevY = 0;
            for (const layer of layering) {
                const heights = layer.map((v) => g.node(v).height);
                const maxHeight = Math.max(...heights);
                for (const v of layer) {
                    g.node(v).y = prevY + maxHeight / 2.0;
                }
                prevY += maxHeight + rankSep;
            }
            for (const entry of Object.entries(positionX(g))) {
                g.node(entry[0]).x = entry[1];
            }
        };

        const positionSelfEdges = (g) => {
            for (const v of g.nodes().keys()) {
                const node = g.node(v);
                if (node.dummy === 'selfedge') {
                    const selfNode = g.node(node.e.v);
                    const x = selfNode.x + selfNode.width / 2;
                    const y = selfNode.y;
                    const dx = node.x - x;
                    const dy = selfNode.height / 2;
                    g.setEdge(node.e.v, node.e.w, node.label);
                    g.removeNode(v);
                    node.label.points = [
                        { x: x + 2 * dx / 3, y: y - dy },
                        { x: x + 5 * dx / 6, y: y - dy },
                        { x: x +     dx    , y: y },
                        { x: x + 5 * dx / 6, y: y + dy },
                        { x: x + 2 * dx / 3, y: y + dy }
                    ];
                    node.label.x = node.x;
                    node.label.y = node.y;
                }
            }
        };

        const removeBorderNodes = (g) => {
            for (const v of g.nodes().keys()) {
                if (g.children(v).length) {
                    const node = g.node(v);
                    const t = g.node(node.borderTop);
                    const b = g.node(node.borderBottom);
                    const l = g.node(node.borderLeft[node.borderLeft.length - 1]);
                    const r = g.node(node.borderRight[node.borderRight.length - 1]);
                    node.width = Math.abs(r.x - l.x);
                    node.height = Math.abs(b.y - t.y);
                    node.x = l.x + node.width / 2;
                    node.y = t.y + node.height / 2;
                }
            }
            for (const v of g.nodes().keys()) {
                if (g.node(v).dummy === 'border') {
                    g.removeNode(v);
                }
            }
        };

        const fixupEdgeLabelCoords = (g) => {
            for (const e of g.edges()) {
                const edge = g.edge(e);
                if ('x' in edge) {
                    if (edge.labelpos === 'l' || edge.labelpos === 'r') {
                        edge.width -= edge.labeloffset;
                    }
                    switch (edge.labelpos) {
                        case 'l': edge.x -= edge.width / 2 + edge.labeloffset; break;
                        case 'r': edge.x += edge.width / 2 + edge.labeloffset; break;
                    }
                }
            }
        };

        const translateGraph = (g) => {
            let minX = Number.POSITIVE_INFINITY;
            let maxX = 0;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = 0;
            const graphLabel = g.graph();
            const marginX = graphLabel.marginx || 0;
            const marginY = graphLabel.marginy || 0;
            const getExtremes = (attrs) => {
                const x = attrs.x;
                const y = attrs.y;
                const w = attrs.width;
                const h = attrs.height;
                minX = Math.min(minX, x - w / 2);
                maxX = Math.max(maxX, x + w / 2);
                minY = Math.min(minY, y - h / 2);
                maxY = Math.max(maxY, y + h / 2);
            };
            for (const node of g.nodes().values()) {
                getExtremes(node);
            }
            for (const e of g.edges()) {
                const edge = g.edge(e);
                if ('x' in edge) {
                    getExtremes(edge);
                }
            }
            minX -= marginX;
            minY -= marginY;
            for (const node of g.nodes().values()) {
                node.x -= minX;
                node.y -= minY;
            }
            for (const e of g.edges()) {
                const edge = g.edge(e);
                for (const p of edge.points) {
                    p.x -= minX;
                    p.y -= minY;
                }
                if ('x' in edge) {
                    edge.x -= minX;
                }
                if ('y' in edge) {
                    edge.y -= minY;
                }
            }
            graphLabel.width = maxX - minX + marginX;
            graphLabel.height = maxY - minY + marginY;
        };

        const assignNodeIntersects = (g) => {
            // Finds where a line starting at point ({x, y}) would intersect a rectangle
            // ({x, y, width, height}) if it were pointing at the rectangle's center.
            const intersectRect = (rect, point) => {
                const x = rect.x;
                const y = rect.y;
                // Rectangle intersection algorithm from: http://math.stackexchange.com/questions/108113/find-edge-between-two-boxes
                const dx = point.x - x;
                const dy = point.y - y;
                let w = rect.width / 2;
                let h = rect.height / 2;
                if (!dx && !dy) {
                    throw new Error('Not possible to find intersection inside of the rectangle');
                }
                let sx;
                let sy;
                if (Math.abs(dy) * w > Math.abs(dx) * h) {
                    // Intersection is top or bottom of rect.
                    if (dy < 0) {
                        h = -h;
                    }
                    sx = h * dx / dy;
                    sy = h;
                }
                else {
                    // Intersection is left or right of rect.
                    if (dx < 0) {
                        w = -w;
                    }
                    sx = w;
                    sy = w * dy / dx;
                }
                return { x: x + sx, y: y + sy };
            };
            for (const e of g.edges()) {
                const edge = g.edge(e);
                const nodeV = g.node(e.v);
                const nodeW = g.node(e.w);
                let p1;
                let p2;
                if (!edge.points) {
                    edge.points = [];
                    p1 = nodeW;
                    p2 = nodeV;
                }
                else {
                    p1 = edge.points[0];
                    p2 = edge.points[edge.points.length - 1];
                }
                edge.points.unshift(intersectRect(nodeV, p1));
                edge.points.push(intersectRect(nodeW, p2));
            }
        };

        const reversePointsForReversedEdges = (g) => {
            for (const e of g.edges()) {
                const edge = g.edge(e);
                if (edge.reversed) {
                    edge.points.reverse();
                }
            }
        };

        time('    makeSpaceForEdgeLabels',        () => { makeSpaceForEdgeLabels(g); });
        time('    removeSelfEdges',               () => { removeSelfEdges(g); });
        time('    acyclic_run',                   () => { acyclic_run(g); });
        time('    nestingGraph_run',              () => { nestingGraph_run(g); });
        time('    rank',                          () => { rank(asNonCompoundGraph(g)); });
        time('    injectEdgeLabelProxies',        () => { injectEdgeLabelProxies(g); });
        time('    removeEmptyRanks',              () => { removeEmptyRanks(g); });
        time('    nestingGraph_cleanup',          () => { nestingGraph_cleanup(g); });
        time('    normalizeRanks',                () => { normalizeRanks(g); });
        time('    assignRankMinMax',              () => { assignRankMinMax(g); });
        time('    removeEdgeLabelProxies',        () => { removeEdgeLabelProxies(g); });
        time('    normalize',                     () => { normalize(g); });
        time('    parentDummyChains',             () => { parentDummyChains(g); });
        time('    addBorderSegments',             () => { addBorderSegments(g); });
        time('    order',                         () => { order(g); });
        time('    insertSelfEdges',               () => { insertSelfEdges(g); });
        time('    coordinateSystem_adjust',       () => { coordinateSystem_adjust(g); });
        time('    position',                      () => { position(g); });
        time('    positionSelfEdges',             () => { positionSelfEdges(g); });
        time('    removeBorderNodes',             () => { removeBorderNodes(g); });
        time('    denormalize',                   () => { denormalize(g); });
        time('    fixupEdgeLabelCoords',          () => { fixupEdgeLabelCoords(g); });
        time('    coordinateSystem_undo',         () => { coordinateSystem_undo(g); });
        time('    translateGraph',                () => { translateGraph(g); });
        time('    assignNodeIntersects',          () => { assignNodeIntersects(g); });
        time('    reversePointsForReversedEdges', () => { reversePointsForReversedEdges(g); });
        time('    acyclic_undo',                  () => { acyclic_undo(g); });
    };

    /*
    * Copies final layout information from the layout graph back to the input
    * graph. This process only copies whitelisted attributes from the layout graph
    * to the input graph, so it serves as a good place to determine what
    * attributes can influence layout.
    */
    const updateInputGraph = (inputGraph, layoutGraph) => {
        for (const v of inputGraph.nodes().keys()) {
            const inputLabel = inputGraph.node(v);
            const layoutLabel = layoutGraph.node(v);
            if (inputLabel) {
                inputLabel.x = layoutLabel.x;
                inputLabel.y = layoutLabel.y;
                if (layoutGraph.children(v).length) {
                    inputLabel.width = layoutLabel.width;
                    inputLabel.height = layoutLabel.height;
                }
            }
        }
        for (const e of inputGraph.edges()) {
            const inputLabel = inputGraph.edge(e);
            const layoutLabel = layoutGraph.edge(e);
            inputLabel.points = layoutLabel.points;
            if ('x' in layoutLabel) {
                inputLabel.x = layoutLabel.x;
                inputLabel.y = layoutLabel.y;
            }
        }
        inputGraph.graph().width = layoutGraph.graph().width;
        inputGraph.graph().height = layoutGraph.graph().height;
    };

    time('layout', () => {
        const layoutGraph =
        time('  buildLayoutGraph', () => { return buildLayoutGraph(graph); });
        time('  runLayout',        () => { runLayout(layoutGraph, time); });
        time('  updateInputGraph', () => { updateInputGraph(graph, layoutGraph); });
    });
};

dagre.Graph = class {

    constructor(options) {
        options = options || {};
        this._isDirected = 'directed' in options ? options.directed : true;
        this._isCompound = 'compound' in options ? options.compound : false;
        this._label = undefined;
        this._defaultNodeLabelFn = () => {
            return undefined;
        };
        this._nodes = new Map();
        if (this._isCompound) {
            this._parent = {};
            this._children = {};
            this._children['\x00'] = {};
        }
        this._in = {};
        this._predecessors = {};
        this._out = {};
        this._successors = {};
        this._edgeKeys = new Map();
        this._edgeLabels = new Map();
    }

    isDirected() {
        return this._isDirected;
    }

    isCompound() {
        return this._isCompound;
    }

    setGraph(label) {
        this._label = label;
    }

    graph() {
        return this._label;
    }

    setDefaultNodeLabel(newDefault) {
        this._defaultNodeLabelFn = newDefault;
    }

    nodes() {
        return this._nodes;
    }

    sources() {
        return Array.from(this.nodes().keys()).filter((v) => {
            const value = this._in[v];
            return value && Object.keys(value).length === 0 && value.constructor === Object;
        });
    }

    setNode(v, node) {
        if (this._nodes.has(v)) {
            if (node) {
                this._nodes.set(v, node);
            }
        }
        else {
            this._nodes.set(v, node ? node : this._defaultNodeLabelFn(v));
            if (this._isCompound) {
                this._parent[v] = '\x00';
                this._children[v] = {};
                this._children['\x00'][v] = true;
            }
            this._in[v] = {};
            this._predecessors[v] = {};
            this._out[v] = {};
            this._successors[v] = {};
        }
    }

    node(v) {
        return this._nodes.get(v);
    }

    hasNode(v) {
        return this._nodes.has(v);
    }

    removeNode(v) {
        if (this._nodes.has(v)) {
            delete this._nodes.delete(v);
            if (this._isCompound) {
                delete this._children[this._parent[v]][v];
                delete this._parent[v];
                for (const child of this.children(v)) {
                    this.setParent(child);
                }
                delete this._children[v];
            }
            for (const e of Object.keys(this._in[v])) {
                this.removeEdge(this._edgeKeys.get(e));
            }
            delete this._in[v];
            delete this._predecessors[v];
            for (const e of Object.keys(this._out[v])) {
                this.removeEdge(this._edgeKeys.get(e));
            }
            delete this._out[v];
            delete this._successors[v];
        }
    }

    setParent(v, parent) {
        if (!this._isCompound) {
            throw new Error('Cannot set parent in a non-compound graph');
        }
        if (parent) {
            for (let ancestor = parent; ancestor !== undefined; ancestor = this.parent(ancestor)) {
                if (ancestor === v) {
                    throw new Error('Setting ' + parent + ' as parent of ' + v + ' would create a cycle.');
                }
            }
            this.setNode(parent);
        }
        else {
            parent = '\x00';
        }
        delete this._children[this._parent[v]][v];
        this._parent[v] = parent;
        this._children[parent][v] = true;
    }

    parent(v) {
        if (this._isCompound) {
            const parent = this._parent[v];
            if (parent !== '\x00') {
                return parent;
            }
        }
    }

    children(v) {
        if (v === undefined) {
            v = '\x00';
        }
        if (this._isCompound) {
            const children = this._children[v];
            if (children) {
                return Object.keys(children);
            }
        }
        else if (v === '\x00') {
            return this.nodes().keys();
        }
        else if (this.hasNode(v)) {
            return [];
        }
    }

    predecessors(v) {
        const value = this._predecessors[v];
        if (value) {
            return Object.keys(value);
        }
    }

    successors(v) {
        const value = this._successors[v];
        if (value) {
            return Object.keys(value);
        }
    }

    neighbors(v) {
        const value = this.predecessors(v);
        if (value) {
            return Array.from(new Set(value.concat(this.successors(v))));
        }
    }

    edges() {
        return this._edgeKeys.values();
    }

    setEdge(v, w, value, name) {
        const e = this.edgeArgsToId(this._isDirected, v, w, name);
        if (this._edgeLabels.has(e)) {
            this._edgeLabels.set(e, value);
        }
        else {
            this.setNode(v);
            this.setNode(w);
            this._edgeLabels.set(e, value);
            if (!this._isDirected && v > w) {
                const tmp = v;
                v = w;
                w = tmp;
            }
            const key = Object.freeze(name ? { v: v, w: w, name: name } : { v: v, w: w });
            this._edgeKeys.set(e, key);
            const incrementOrInitEntry = (map, k) => {
                if (map[k]) {
                    map[k]++;
                }
                else {
                    map[k] = 1;
                }
            };
            incrementOrInitEntry(this._predecessors[w], v);
            incrementOrInitEntry(this._successors[v], w);
            this._in[w][e] = key;
            this._out[v][e] = key;
        }
    }

    edge(v, w) {
        const key = (arguments.length === 1 ? this.edgeObjToId(this._isDirected, arguments[0]) : this.edgeArgsToId(this._isDirected, v, w));
        return this._edgeLabels.get(key);
    }

    hasEdge(v, w) {
        const key = this.edgeArgsToId(this._isDirected, v, w);
        return this._edgeLabels.has(key);
    }

    removeEdge(e) {
        const key = this.edgeObjToId(this._isDirected, e);
        const edge = this._edgeKeys.get(key);
        if (edge) {
            const v = edge.v;
            const w = edge.w;
            this._edgeLabels.delete(key);
            this._edgeKeys.delete(key);
            const decrementOrRemoveEntry = (map, k) => {
                if (!--map[k]) {
                    delete map[k];
                }
            };
            decrementOrRemoveEntry(this._predecessors[w], v);
            decrementOrRemoveEntry(this._successors[v], w);
            delete this._in[w][key];
            delete this._out[v][key];
        }
    }

    inEdges(v) {
        return Object.values(this._in[v]);
    }

    outEdges(v) {
        return Object.values(this._out[v]);
    }

    nodeEdges(v) {
        return this.inEdges(v).concat(this.outEdges(v));
    }

    edgeArgsToId(isDirected, v, w, name) {
        if (!isDirected && v > w) {
            return name ? w + ':' + v + ':' + name : w + ':' + v + ':';
        }
        return name ? v + ':' + w + ':' + name : v + ':' + w + ':';
    }

    edgeObjToId(isDirected, edgeObj) {
        return this.edgeArgsToId(isDirected, edgeObj.v, edgeObj.w, edgeObj.name);
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports = dagre;
}
