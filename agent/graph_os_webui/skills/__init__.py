"""CONCEPT:WU-OS.deployment.graph-os-webui-skill-provider — graph-os-webui skill provider.

Data-only subpackage that contributes the ``graphos-webui-*`` skills (graphviz,
ontology-operator, admin, dashboards, extraction, swe) to the agent-utilities hub via
the ``agent_utilities.skill_providers`` entry-point, exactly like ``epistemic_graph.skills``
and each ``agents/*`` connector. Carries no runtime imports — the hub resolves this
package's directory through ``importlib.resources`` and reads the ``SKILL.md`` files;
it never executes webui business logic.
"""
