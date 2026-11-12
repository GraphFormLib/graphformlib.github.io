// Verbatim definitions from the frozen objective library. Generated; see tools/build_taxonomy.py.
export const taxonomy = Object.freeze({
  "library_version": "objective-library-v3",
  "source_sha256": "103d1b367cb4b7b40b42c4c80828bb02831110ebd417f9a02f914c61721867eb",
  "directions": {
    "promote": "Increase, establish, maximize, or preserve the named structural property.",
    "reduce": "Decrease, eliminate, minimize, or suppress the named structural property."
  },
  "decision_types": {
    "graph_object_selection": "Select an existing graph-supported object or organization without changing the evaluated graph.",
    "graph_intervention": "Choose an action that changes usable topology or its state under disruption."
  },
  "families": [
    {
      "objective_family_id": "reachability",
      "name": "Reachability",
      "definition": "For a declared ordered or unordered target pair, whether at least one unweighted path exists; aggregate objectives count the required pairs satisfying that predicate.",
      "direction_semantics": {
        "promote": "establishes or preserves ordinary access.",
        "reduce": "fragments, isolates, or blocks it."
      }
    },
    {
      "objective_family_id": "robustness",
      "name": "Robustness",
      "definition": "persistence of required path existence or connectedness after an explicitly declared node/edge disruption. The family is failure-conditioned connectivity, not generic reliability.",
      "direction_semantics": {
        "promote": "increases disruption survival.",
        "reduce": "makes a hostile network easier to break."
      }
    },
    {
      "objective_family_id": "centrality",
      "name": "Centrality",
      "definition": "topology-based prominence of one focal node or edge—hub, broker, gateway, or path intermediary. Exact degree-, closeness-, or betweenness-like equations remain document context.",
      "direction_semantics": {
        "promote": "selects or creates greater focal prominence.",
        "reduce": "removes structural dependence on the focal object."
      }
    },
    {
      "objective_family_id": "density",
      "name": "Density",
      "definition": "Direct relationship abundance relative to the possible pairs in the stated comparison context.",
      "direction_semantics": {
        "promote": "selects or builds more saturated relation structure.",
        "reduce": "preserves sparsity."
      }
    },
    {
      "objective_family_id": "community_separation",
      "name": "Community separation",
      "definition": "relative strength of within-group connectivity versus cross-boundary connectivity for a selected or operationally declared partition.",
      "direction_semantics": {
        "promote": "strengthens separation.",
        "reduce": "integrates across boundaries."
      }
    },
    {
      "objective_family_id": "path_distance",
      "name": "Path distance",
      "definition": "unweighted shortest-path hop count over a fixed, reachable endpoint universe.",
      "direction_semantics": {
        "promote": "lengthens it without receiving credit for disconnection.",
        "reduce": "shortens the minimum hop count."
      }
    }
  ]
});
