// Assistant-written illustrative interface fixtures, not study data or empirical ablation evidence.
export const demoCases = [
  {
    "fixture_id": "documentation-navigation",
    "genre": "operational_email",
    "gold": {
      "node_meaning": "web page",
      "edge_meaning": "one page contains a direct hyperlink to another page",
      "objectives": [
        {
          "objective_family": "centrality",
          "direction": "promote",
          "decision_type": "graph_object_selection"
        },
        {
          "objective_family": "path_distance",
          "direction": "reduce",
          "decision_type": "graph_object_selection"
        }
      ]
    },
    "variants": {
      "full_pipeline": {
        "text": "Subject: Navigation example for Thursday's review\n\nHi Sam,\n\nCould you choose one of the existing documentation-site examples for Thursday's navigation review? The shared folder has the page lists and direct hyperlinks for each example.\n\nWe'd like the overview page to do more work as an intermediary: more of the shortest click routes between other pages should pass through it. We'd also like a short route from the installation page to the troubleshooting page, using as few successive clicks as possible. Please consider both preferences when recommending an example.\n\nSend the example name and a brief explanation before the meeting. We'll use your recommendation to guide the discussion.\n\nThanks,\nAlex",
        "available": true
      },
      "writer_only": {
        "text": "Subject: Example for the navigation review\n\nHi Sam,\n\nPlease select one existing documentation-site example from our shortlist. The shared records identify its pages and the direct hyperlinks between them.\n\nFor the review, we want an example whose overview page is an intermediary on more of the shortest click routes between other pages. We also want the shortest route from the installation page to troubleshooting to require fewer successive clicks. Both criteria should influence your selection.\n\nPlease send the example name with a short explanation of how it meets those two preferences.\n\nThanks,\nAlex",
        "available": true
      },
      "minimal_one_shot": {
        "text": "Navigation review request\n\nSelect one existing documentation-site example. Nodes represent pages and directed edges represent direct hyperlinks. The objectives are to promote the centrality of the overview page and reduce path distance from installation to troubleshooting. Centrality is assessed by the overview page's intermediary role on shortest paths between other pages. Distance counts successive hyperlinks.\n\nUse both objectives to choose the example and report the choice with a brief rationale.",
        "available": true
      }
    },
    "variant_order": [
      "writer_only",
      "minimal_one_shot",
      "full_pipeline"
    ]
  },
  {
    "fixture_id": "water-maintenance",
    "genre": "team_conversation",
    "gold": {
      "node_meaning": "pipe junction",
      "edge_meaning": "a pipe section directly connects two junctions",
      "objectives": [
        {
          "objective_family": "robustness",
          "direction": "promote",
          "decision_type": "graph_intervention"
        }
      ]
    },
    "variants": {
      "full_pipeline": {
        "text": "Maya: We need the next round of backup-pipe proposals before Friday. The maintenance map shows the junctions and the pipe sections running between them.\n\nOwen: Are we looking at the north district again?\n\nMaya: Yes. Closing the section near Pine Street last month left several junctions cut off from the pumping station. I'd like you to propose additional pipe connections that would let us keep the district connected while any one existing section is closed for repairs.\n\nOwen: I'll compare a few layouts against each possible single-section closure and bring the most resilient option to the meeting.\n\nMaya: Great. Please mark the proposed connections on the map so the maintenance team can discuss where they could go.",
        "available": true
      },
      "writer_only": {
        "text": "Maya: Please propose additional pipe connections for the north district. Our maintenance map records pipe junctions and the pipe sections directly connecting them.\n\nOwen: What should I prioritize?\n\nMaya: Improving resilience to a single pipe-section closure. More junctions should remain connected to the pumping station when any one existing section is closed for maintenance.\n\nOwen: I'll compare the proposed layouts under those closures and recommend the most resilient one by Friday.",
        "available": true
      },
      "minimal_one_shot": {
        "text": "Maya: Model the district as junction nodes with undirected pipe-section edges. Propose additional edges to promote robustness against a single existing-edge closure.\n\nOwen: I will compare candidate interventions by how well junctions retain connectivity to the pumping station after each possible closure and recommend a layout.",
        "available": true
      }
    },
    "variant_order": [
      "full_pipeline",
      "writer_only",
      "minimal_one_shot"
    ]
  },
  {
    "fixture_id": "parcel-transfers",
    "genre": "meeting_notes",
    "gold": {
      "node_meaning": "parcel depot",
      "edge_meaning": "a scheduled direct overnight transfer service from one depot to another",
      "objectives": [
        {
          "objective_family": "reachability",
          "direction": "promote",
          "decision_type": "graph_intervention"
        },
        {
          "objective_family": "path_distance",
          "direction": "reduce",
          "decision_type": "graph_intervention"
        },
        {
          "objective_family": "robustness",
          "direction": "promote",
          "decision_type": "graph_intervention"
        }
      ]
    },
    "variants": {
      "full_pipeline": {
        "text": "## Regional parcel operations — planning meeting\n\n**Attendees:** Lena, Samir, Jo\n\nThe team reviewed the overnight transfer schedule. Each entry names the sending depot and the receiving depot for a direct service. Two eastern depots still cannot be reached by following the scheduled transfers from Riverside.\n\nThe next proposal will add direct services to the existing schedule. The team agreed on three priorities:\n- Give parcels leaving Riverside a transfer route to every depot in the region.\n- Reduce the number of depot-to-depot handoffs on the Riverside-to-Harbor journey.\n- Keep more depots reachable from Riverside when any single scheduled service is cancelled.\n\nSamir will compare the proposed schedules against all three priorities. Jo will check which additional services the carriers could operate. The team will choose a proposal at next Tuesday's meeting.",
        "available": true
      },
      "writer_only": {
        "text": "## Regional parcel planning notes\n\nThe overnight schedule lists direct transfers from sending depots to receiving depots. The team will add services to improve the schedule.\n\nThe proposal should achieve three objectives: expand the set of depots reachable from Riverside, shorten the Riverside-to-Harbor journey in number of successive transfers, and improve the retention of depot access from Riverside after any one scheduled service is cancelled.\n\nSamir will assess the proposals against all three criteria. Jo will check operational feasibility. A recommendation is due next Tuesday.",
        "available": true
      },
      "minimal_one_shot": {
        "text": "## Parcel network planning\n\nNodes are depots. A directed edge is a scheduled direct overnight transfer. The decision is a graph intervention: add direct services.\n\nObjectives:\n- Promote reachability from Riverside.\n- Reduce shortest-path distance, measured in transfers, from Riverside to Harbor.\n- Promote robustness of reachability from Riverside under any single service cancellation.\n\nCompare the proposals on these three objectives and recommend one for Tuesday.",
        "available": true
      }
    },
    "variant_order": [
      "minimal_one_shot",
      "full_pipeline",
      "writer_only"
    ]
  }
];
